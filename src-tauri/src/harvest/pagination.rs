//! CMS HTML 适配层。模型只能返回编号，输出正文始终从本地节点重建。
use super::{HarvestError, content};
use crate::ai::pagination_plan::{count, sentences, whitespace};
use crate::ai::{AiService, PaginationBlock, PaginationBlockType as Kind, PaginationSnapshot};
use crate::database::Database;
use scraper::{ElementRef, Html, Node};
use std::collections::HashSet;

const MARKER: &str = "[!--empirenews.page--]";
const BREAK: &str = "<p>[!--empirenews.page--]</p>";

#[derive(Clone)]
enum LocalNode {
    Text(String),
    Comment(String),
    Element {
        name: String,
        attrs: Vec<(String, String)>,
        children: Vec<LocalNode>,
    },
}
impl LocalNode {
    fn element(element: ElementRef<'_>, depth: usize) -> Result<Self, HarvestError> {
        if depth > 128 {
            return Err(HarvestError::invalid("正文嵌套过深，保留原排版"));
        }
        let mut children = Vec::new();
        for child in element.children() {
            children.push(match child.value() {
                Node::Text(text) => Self::Text(text.text.to_string()),
                Node::Comment(text) => Self::Comment(text.to_string()),
                Node::Element(_) => Self::element(ElementRef::wrap(child).unwrap(), depth + 1)?,
                _ => return Err(HarvestError::invalid("正文结构不支持安全分页，保留原排版")),
            });
        }
        Ok(Self::Element {
            name: element.value().name().into(),
            attrs: element
                .value()
                .attrs()
                .map(|(k, v)| (k.into(), v.into()))
                .collect(),
            children,
        })
    }
    fn name(&self) -> &str {
        if let Self::Element { name, .. } = self {
            name
        } else {
            ""
        }
    }
    fn text(&self) -> String {
        match self {
            Self::Text(text) => text.clone(),
            Self::Comment(_) => String::new(),
            Self::Element { children, .. } => children.iter().map(Self::text).collect(),
        }
    }
    fn image(&self) -> bool {
        self.name() == "img"
            || matches!(self, Self::Element {children,..} if children.iter().any(Self::image))
    }
    fn only_text(&self) -> bool {
        match self {
            Self::Text(_) | Self::Comment(_) => true,
            Self::Element { name, children, .. } => {
                !matches!(
                    name.as_str(),
                    "img" | "br" | "hr" | "video" | "audio" | "input" | "source"
                ) && children.iter().all(Self::only_text)
            }
        }
    }
    fn marker(&self) -> bool {
        self.name() == "p" && self.text() == MARKER
    }
    fn compatible(&self) -> bool {
        match self {
            Self::Text(_) | Self::Comment(_) => true,
            Self::Element { name, children, .. } => {
                matches!(
                    name.as_str(),
                    "p" | "h1"
                        | "h2"
                        | "h3"
                        | "h4"
                        | "h5"
                        | "h6"
                        | "ul"
                        | "ol"
                        | "li"
                        | "blockquote"
                        | "pre"
                        | "hr"
                        | "br"
                        | "img"
                        | "span"
                        | "strong"
                        | "b"
                        | "em"
                        | "i"
                        | "u"
                        | "s"
                        | "strike"
                        | "del"
                        | "code"
                        | "a"
                ) && children.iter().all(Self::compatible)
            }
        }
    }
    fn nested_marker(&self) -> bool {
        matches!(self, Self::Element {children,..} if children.iter().any(|c| c.marker() || c.nested_marker()))
    }
    fn caption(&self) -> bool {
        self.name() == "p"
            && matches!(self, Self::Element {attrs,..} if attrs.iter().any(|(k,v)| k == "class" && v.split_ascii_whitespace().any(|c| c == "img-caption")))
    }
    fn opening(&self) -> String {
        let Self::Element { name, attrs, .. } = self else {
            return String::new();
        };
        format!(
            "<{name}{}>",
            attrs
                .iter()
                .map(|(k, v)| format!(" {k}=\"{}\"", content::escape(v)))
                .collect::<String>()
        )
    }
    fn render(&self) -> String {
        match self {
            Self::Text(text) => content::escape(text),
            Self::Comment(text) => format!("<!--{text}-->"),
            Self::Element { name, children, .. } => {
                let open = self.opening();
                if matches!(
                    name.as_str(),
                    "img" | "br" | "hr" | "input" | "source" | "wbr"
                ) {
                    return open;
                }
                format!(
                    "{open}{}</{name}>",
                    children.iter().map(Self::render).collect::<String>()
                )
            }
        }
    }
    fn slice(&self, from: usize, to: usize) -> String {
        if from == 0 && to == self.text().len() {
            return self.render();
        }
        match self {
            Self::Text(text) => content::escape(&text[from..to]),
            Self::Comment(_) => self.render(),
            Self::Element { name, children, .. } => {
                let mut offset = 0;
                let mut output = self.opening();
                for child in children {
                    let length = child.text().len();
                    let end = offset + length;
                    if (offset < to && end > from) || (length == 0 && offset >= from && offset < to)
                    {
                        output.push_str(
                            &child.slice(from.saturating_sub(offset), to.min(end) - offset),
                        );
                    }
                    offset = end;
                }
                format!("{output}</{name}>")
            }
        }
    }
}
struct Unit {
    node: LocalNode,
    parts: Vec<(usize, usize, String)>,
}
pub(super) struct PreparedHtml {
    units: Vec<Unit>,
    pub blocks: Vec<PaginationBlock>,
}

fn source(text: &str) -> bool {
    let text = text.trim_matches(whitespace);
    ["来源", "记者", "编辑", "责编", "校对", "审核", "美编"]
        .iter()
        .any(|prefix| {
            text.strip_prefix(prefix)
                .is_some_and(|rest| rest.trim_start_matches(whitespace).starts_with([':', '：']))
        })
}
pub(super) fn prepare(html: &str) -> Result<PreparedHtml, HarvestError> {
    if html.len() > 4_000_000 {
        return Err(HarvestError::invalid("分页内容最多 4 MB，不会截断正文"));
    }
    let root = LocalNode::element(Html::parse_fragment(html).root_element(), 0)?;
    let LocalNode::Element { children, .. } = root else {
        unreachable!()
    };
    let mut units = Vec::new();
    let mut blocks = Vec::new();
    let mut last_image = None;
    for (paragraph, node) in children.into_iter().enumerate() {
        if node.marker() {
            continue;
        }
        if node.nested_marker() {
            return Err(HarvestError::invalid("存在嵌套分页，保留原排版"));
        }
        if !node.compatible() {
            return Err(HarvestError::invalid("正文包含不支持的结构，保留原排版"));
        }
        let text = node.text();
        // 缩进空白和注释原样保留，不把它们当成正文段落。
        if matches!(node, LocalNode::Text(_) | LocalNode::Comment(_)) {
            if text.chars().any(|c| !whitespace(c)) {
                return Err(HarvestError::invalid("正文包含未分段文字，保留原排版"));
            }
            units.push(Unit {
                node,
                parts: vec![],
            });
            continue;
        }
        if !matches!(
            node.name(),
            "p" | "h1"
                | "h2"
                | "h3"
                | "h4"
                | "h5"
                | "h6"
                | "ul"
                | "ol"
                | "blockquote"
                | "pre"
                | "hr"
                | "br"
                | "img"
                | "video"
                | "audio"
        ) {
            return Err(HarvestError::invalid("正文结构不支持安全分页，保留原排版"));
        }
        let image = node.image();
        let caption = node.caption();
        let is_source = !image && source(&text);
        let heading = matches!(node.name(), "h1" | "h2" | "h3" | "h4" | "h5" | "h6");
        let ends = if node.name() == "p" && node.only_text() && !caption && !is_source {
            sentences(&text)
        } else {
            vec![text.len()]
        };
        let mut from = 0;
        let mut parts = Vec::new();
        for to in ends {
            let id = format!("B{}", blocks.len() + 1);
            let content = &text[from..to];
            let kind = if caption {
                Kind::Caption
            } else if heading {
                Kind::Heading
            } else if is_source {
                Kind::Source
            } else if image && content.trim_matches(whitespace).is_empty() {
                Kind::Image
            } else {
                Kind::Text
            };
            blocks.push(PaginationBlock {
                id: id.clone(),
                r#type: kind,
                paragraph: paragraph as u32,
                chars: count(content),
                text: (!content.is_empty()).then(|| content.to_owned()),
                caption_of: if caption { last_image.clone() } else { None },
                keep_with_next: heading.then_some(true),
            });
            parts.push((from, to, id.clone()));
            if image {
                last_image = Some(id);
            } else if !caption && !content.trim_matches(whitespace).is_empty() {
                last_image = None;
            }
            from = to;
        }
        units.push(Unit { node, parts });
        if blocks.len() > 10_000 {
            return Err(HarvestError::invalid(
                "分页内容块最多 10000 个，不会截断正文",
            ));
        }
    }
    if !blocks
        .iter()
        .any(|b| b.chars > 0 || b.r#type == Kind::Image)
    {
        return Err(HarvestError::invalid("正文为空，无法生成分页"));
    }
    Ok(PreparedHtml { units, blocks })
}
impl PreparedHtml {
    pub(super) fn render(&self, boundaries: &[String]) -> String {
        let boundaries: HashSet<_> = boundaries.iter().collect();
        let mut result = String::new();
        for unit in &self.units {
            let mut start = 0;
            for (_, to, id) in &unit.parts {
                if boundaries.contains(id) {
                    result.push_str(&unit.node.slice(start, *to));
                    result.push_str(BREAK);
                    start = *to;
                }
            }
            let end = unit.node.text().len();
            if start < end || !unit.parts.iter().any(|(_, _, id)| boundaries.contains(id)) {
                result.push_str(&unit.node.slice(start, end));
            }
        }
        result
    }
}
pub(super) async fn paginate(
    ai: &AiService,
    db: &Database,
    snapshot: Option<&PaginationSnapshot>,
    title: &str,
    html: &str,
) -> Result<String, HarvestError> {
    let document = prepare(html)?;
    if document.blocks.iter().all(|b| b.chars == 0) {
        return Ok(document.render(&[]));
    }
    let snapshot = snapshot.ok_or_else(|| {
        HarvestError::invalid(
            "入队时默认文章分页模板未配置完整，请配置模板、绑定模型及页长后创建新任务",
        )
    })?;
    let plan = tokio::time::timeout(
        std::time::Duration::from_secs(60),
        ai.paginate_snapshot(db, snapshot, title, &document.blocks),
    )
    .await
    .map_err(|_| HarvestError::new("AI_TIMEOUT", "AI 自动分页超过 60 秒，保留原排版"))??;
    Ok(document.render(&plan.break_after))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::{PaginationOptions, pagination_plan};
    use serde_json::Value;

    // 比较每个字符及其格式祖先，允许分页拆段但不允许移动、改写或丢失格式。
    fn signature(node: &LocalNode, ancestors: &str, out: &mut Vec<String>) {
        if node.marker() {
            return;
        }
        match node {
            LocalNode::Text(text) => out.extend(text.chars().map(|c| format!("{ancestors}:{c}"))),
            LocalNode::Comment(_) => out.push(node.render()),
            LocalNode::Element { children, .. } => {
                let ancestors = format!("{ancestors}{}", node.opening());
                if children.is_empty() && node.name() == "img" {
                    out.push(node.render());
                }
                for child in children {
                    signature(child, &ancestors, out);
                }
            }
        }
    }
    #[test]
    fn editor_and_import_share_v9_fixtures_and_preserve_html() {
        let fixtures: Vec<Value> = serde_json::from_str(include_str!(
            "../../../src/test/fixtures/pagination-shared.json"
        ))
        .unwrap();
        for fixture in fixtures {
            let html = fixture["html"].as_str().unwrap();
            let document = prepare(html).unwrap();
            let expected: Vec<PaginationBlock> =
                serde_json::from_value(fixture["blocks"].clone()).unwrap();
            assert_eq!(document.blocks, expected, "{}", fixture["id"]);
            let semantic = serde_json::from_value(fixture["semantic"].clone()).unwrap();
            let options: PaginationOptions =
                serde_json::from_value(fixture["options"].clone()).unwrap();
            let boundaries = pagination_plan::plan(&document.blocks, &semantic, &options).unwrap();
            assert_eq!(
                serde_json::to_value(&boundaries).unwrap(),
                fixture["breakAfter"],
                "{}",
                fixture["id"]
            );
            let output = document.render(&boundaries);
            let before = LocalNode::element(Html::parse_fragment(html).root_element(), 0).unwrap();
            let after =
                LocalNode::element(Html::parse_fragment(&output).root_element(), 0).unwrap();
            let (mut a, mut b) = (Vec::new(), Vec::new());
            signature(&before, "", &mut a);
            signature(&after, "", &mut b);
            assert_eq!(a, b, "{}", fixture["id"]);
        }
    }
    #[test]
    fn unsupported_or_nested_content_is_rejected_before_mutation() {
        for html in [
            "<p></p>",
            "<div><p>[!--empirenews.page--]</p></div>",
            "<blockquote><p>[!--empirenews.page--]</p></blockquote>",
            "<table><tr><td>【演示数据】表格</td></tr></table>",
        ] {
            assert!(prepare(html).is_err());
        }
        let html = "<p>【演示数据】原有排版。</p><br><p>[!--empirenews.page--]</p><p><img src=\"demo.png\"></p><p class=\"img-caption\">演示图注</p>";
        let doc = prepare(html).unwrap();
        assert_eq!(doc.blocks.last().unwrap().caption_of, Some("B3".into()));
    }
}
