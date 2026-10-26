//! 由 ArticleHarvest ai_layout.py 移植：保留编号引用校验及 240/280/100 分页算法。
use super::{
    HarvestError,
    content::{escape, plain_text, with_breaks},
};
use regex::Regex;
use scraper::{ElementRef, Html, Node, Selector};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet},
    sync::LazyLock,
};

pub(super) const PROMPT: &str = include_str!("layout-prompt.txt");
const PAGE_BREAK: &str = "[!--empirenews.page--]";
const UNSUPPORTED: &str = "table,video,audio,iframe,svg,math,canvas,object,embed,picture,source,input,button,select,textarea,script,style,pre,code";
static SOURCE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^来源\s*[:：][^\n。！？!?]+。?$").expect("固定正则"));
static TAIL: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(?:(?:记者|编辑|责编|校对|审核|美编)\s*[:：]|点击上方|长按.*(?:关注|二维码)|未经授权|版权声明)").expect("固定正则")
});
static CAPTION_END: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\s*[（(](?:图源|图片来源|图片来自|供图)\s*[:：][^（）()\n]*[）)]\s*$")
        .expect("固定正则")
});
static CAPTION_SOURCE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\s*(?:图源|图片来源|图片来自|供图)\s*[:：][^（）()\n]*$").expect("固定正则")
});
fn invalid(message: &str) -> HarvestError {
    HarvestError::new("HARVEST_LAYOUT", message)
}
fn block_tag(name: &str) -> bool {
    matches!(
        name,
        "p" | "div"
            | "section"
            | "article"
            | "blockquote"
            | "figure"
            | "figcaption"
            | "h1"
            | "h2"
            | "h3"
            | "h4"
            | "h5"
            | "h6"
            | "li"
            | "dt"
            | "dd"
            | "header"
            | "footer"
    )
}
fn count(text: &str) -> usize {
    text.chars().filter(|c| !c.is_whitespace()).count()
}
fn sentences(text: &str) -> Vec<String> {
    let chars = text.chars().collect::<Vec<_>>();
    let mut stack = Vec::new();
    let mut parts = Vec::new();
    let mut start = 0;
    let mut pending = false;
    for (index, &c) in chars.iter().enumerate() {
        match c {
            '"' => {
                if stack.last() == Some(&'"') {
                    stack.pop();
                } else {
                    stack.push('"');
                    pending = false;
                }
            }
            '“' | '‘' | '「' | '『' | '（' | '(' => {
                stack.push(match c {
                    '“' => '”',
                    '‘' => '’',
                    '「' => '」',
                    '『' => '』',
                    '（' => '）',
                    _ => ')',
                });
                pending = false;
            }
            _ if stack.last() == Some(&c) => {
                stack.pop();
            }
            '。' | '！' | '？' | '!' | '?' => pending = true,
            '.' if chars.get(index + 1).is_none_or(|next| next.is_whitespace()) => pending = true,
            _ if !"”’」』）)\"".contains(c) && !c.is_whitespace() => pending = false,
            _ => {}
        }
        if pending
            && stack.is_empty()
            && chars
                .get(index + 1)
                .is_none_or(|next| !"。！？!?”’」』）)\"".contains(*next))
        {
            parts.push(chars[start..=index].iter().collect());
            start = index + 1;
            pending = false;
        }
    }
    if start < chars.len() {
        parts.push(chars[start..].iter().collect());
    }
    parts
}
struct TextBlock {
    id: String,
    ids: Vec<String>,
    caption: Option<String>,
}
pub(super) struct Document {
    blocks: Vec<Value>,
    texts: Vec<(String, String)>,
    text_index: HashMap<String, usize>,
    images: Vec<(String, String)>,
    text_blocks: Vec<TextBlock>,
    captions: HashMap<String, Vec<String>>,
    source: Option<String>,
}
impl Document {
    fn flush(&mut self, buffer: &mut String, caption: Option<&str>) {
        let text = std::mem::take(buffer);
        let text = text.trim();
        if text.is_empty() {
            return;
        }
        let mut ids = Vec::new();
        for sentence in sentences(text) {
            let id = format!("T{}", self.texts.len() + 1);
            ids.push(id.clone());
            self.text_index.insert(id.clone(), self.texts.len());
            self.texts.push((id, sentence));
        }
        let id = format!("B{}", self.blocks.len() + 1);
        let mut block = json!({"id":id,"fragments":ids});
        if let Some(caption) = caption {
            block["caption_of"] = json!(caption);
            self.captions
                .entry(caption.to_string())
                .or_default()
                .extend(ids.clone());
        }
        self.blocks.push(block);
        self.text_blocks.push(TextBlock {
            id,
            ids,
            caption: caption.map(str::to_owned),
        });
    }
    fn text(&self, id: &str) -> Option<&str> {
        self.text_index
            .get(id)
            .map(|&index| self.texts[index].1.as_str())
    }
    fn visit(
        &mut self,
        element: ElementRef<'_>,
        image_ids: &HashMap<String, String>,
        buffer: &mut String,
        caption: Option<&str>,
        previous: &mut Option<String>,
    ) {
        let name = element.value().name();
        if matches!(name, "br" | "hr" | "img") {
            self.flush(buffer, caption);
            if name == "img" {
                let id = image_ids[&format!("{:?}", element.id())].clone();
                *previous = Some(id.clone());
                self.blocks.push(json!({"type":"image","id":id}));
            }
            return;
        }
        let block = block_tag(name);
        if block {
            self.flush(buffer, caption);
        }
        let owned_caption = if name == "figcaption"
            || element.value().classes().any(|name| name == "img-caption")
        {
            if let Some(figure) = element
                .ancestors()
                .filter_map(ElementRef::wrap)
                .find(|e| e.value().name() == "figure")
            {
                let figure_images = figure
                    .select(&Selector::parse("img").expect("固定选择器"))
                    .map(|image| image_ids[&format!("{:?}", image.id())].clone())
                    .collect::<Vec<_>>();
                previous
                    .as_ref()
                    .filter(|id| figure_images.contains(id))
                    .cloned()
                    .or_else(|| figure_images.first().cloned())
            } else {
                previous.clone()
            }
        } else {
            caption.map(str::to_owned)
        };
        for child in element.children() {
            match child.value() {
                Node::Text(text) => {
                    for (index, piece) in text.text.split(PAGE_BREAK).enumerate() {
                        if index > 0 {
                            self.flush(buffer, owned_caption.as_deref());
                        }
                        buffer.push_str(piece);
                    }
                }
                Node::Element(_) => self.visit(
                    ElementRef::wrap(child).expect("元素节点"),
                    image_ids,
                    buffer,
                    owned_caption.as_deref(),
                    previous,
                ),
                _ => {}
            }
        }
        if block {
            self.flush(buffer, owned_caption.as_deref());
        }
    }
    pub(super) fn input(&self) -> Vec<Value> {
        self.blocks.iter().map(|block| {
            let mut block=block.clone();
            if let Some(ids)=block.get("fragments").and_then(Value::as_array) {
                block["fragments"]=json!(ids.iter().map(|id|json!({"id":id,"text":self.text(id.as_str().expect("内部编号"))})).collect::<Vec<_>>());
            }
            block
        }).collect()
    }
}
pub(super) fn prepare(html: &str) -> Result<Document, HarvestError> {
    let dom = Html::parse_fragment(html);
    if dom
        .select(&Selector::parse(UNSUPPORTED).expect("固定选择器"))
        .next()
        .is_some()
    {
        return Err(invalid("正文包含暂不支持的媒体结构，保留后台原排版"));
    }
    let mut document = Document {
        blocks: Vec::new(),
        texts: Vec::new(),
        text_index: HashMap::new(),
        images: Vec::new(),
        text_blocks: Vec::new(),
        captions: HashMap::new(),
        source: None,
    };
    let mut image_ids = HashMap::new();
    for (index, image) in dom
        .select(&Selector::parse("img").expect("固定选择器"))
        .enumerate()
    {
        let id = format!("IMG_{}", index + 1);
        image_ids.insert(format!("{:?}", image.id()), id.clone());
        document.images.push((id, image.html()));
    }
    let mut buffer = String::new();
    document.visit(dom.root_element(), &image_ids, &mut buffer, None, &mut None);
    document.flush(&mut buffer, None);
    for index in (0..document.text_blocks.len()).rev() {
        let block = &document.text_blocks[index];
        if block.caption.is_some() {
            continue;
        }
        let text = block
            .ids
            .iter()
            .filter_map(|id| document.text(id))
            .collect::<String>();
        if SOURCE.is_match(&text) {
            document.source = Some(text);
            let block = document.text_blocks.remove(index);
            document.texts.retain(|(id, _)| !block.ids.contains(id));
            document.text_index = document
                .texts
                .iter()
                .enumerate()
                .map(|(i, (id, _))| (id.clone(), i))
                .collect();
            document
                .blocks
                .retain(|b| b.get("id").and_then(Value::as_str) != Some(&block.id));
            break;
        }
        if !TAIL.is_match(&text) {
            break;
        }
    }
    if document.texts.is_empty() {
        return Err(invalid("没有可整理的正文文字"));
    }
    Ok(document)
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Response {
    groups: Vec<Vec<Block>>,
    drop_blocks: Vec<String>,
}
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase", deny_unknown_fields)]
enum Block {
    Paragraph {
        ids: Vec<String>,
    },
    Image {
        id: String,
        caption_ids: Vec<String>,
    },
}
#[derive(Default)]
struct Group {
    html: String,
    length: usize,
    paragraphs: usize,
}
fn clean_caption(text: &str) -> String {
    let text = text.trim_start_matches(|c: char| c.is_whitespace() || "▲△▼▽◆◇▶▷".contains(c));
    let text = CAPTION_END.replace(text, "");
    CAPTION_SOURCE.replace(&text, "").trim_end().to_string()
}
fn pages(groups: &[Group], paginate: bool) -> Vec<String> {
    if !paginate {
        return vec![groups.iter().map(|g| g.html.as_str()).collect()];
    }
    let mut lengths = vec![0usize];
    let mut paragraphs = vec![0usize];
    for group in groups {
        lengths.push(lengths.last().expect("前缀初值") + group.length);
        paragraphs.push(paragraphs.last().expect("前缀初值") + group.paragraphs);
    }
    let end = groups.len();
    let mut boundaries = vec![0];
    let mut start = 0;
    while start < end {
        if lengths[end] - lengths[start] <= 280 {
            boundaries.push(end);
            break;
        }
        let mut best = start + 1;
        let mut score = None;
        for next in start + 1..=end {
            let length = lengths[next] - lengths[start];
            let count = paragraphs[next] - paragraphs[start];
            let current = (
                (length as i64 - 240).pow(2),
                !(3..=4).contains(&count),
                next,
            );
            if score.is_none_or(|s| current < s) {
                score = Some(current);
                best = next;
            }
            if length >= 280 {
                break;
            }
        }
        boundaries.push(best);
        start = best;
    }
    if boundaries.len() > 2 && lengths[end] - lengths[boundaries[boundaries.len() - 2]] < 100 {
        let start = boundaries[boundaries.len() - 3];
        let mut best = None;
        let mut score = None;
        for next in start + 1..end {
            let left = lengths[next] - lengths[start];
            let right = lengths[end] - lengths[next];
            if right < 100 {
                break;
            }
            let left_count = paragraphs[next] - paragraphs[start];
            let right_count = paragraphs[end] - paragraphs[next];
            let current = (
                (left as i64 - 240).pow(2) + (right as i64 - 240).pow(2),
                usize::from(!(3..=4).contains(&left_count))
                    + usize::from(!(3..=4).contains(&right_count)),
                next,
            );
            if score.is_none_or(|s| current < s) {
                score = Some(current);
                best = Some(next);
            }
        }
        let index = boundaries.len() - 2;
        if let Some(best) = best {
            boundaries[index] = best;
        } else {
            boundaries.remove(index);
        }
    }
    boundaries
        .windows(2)
        .map(|b| groups[b[0]..b[1]].iter().map(|g| g.html.as_str()).collect())
        .collect()
}
pub(super) fn render(
    document: &Document,
    text: &str,
    paginate: bool,
) -> Result<String, HarvestError> {
    let result: Response = serde_json::from_str(text).map_err(|error| {
        invalid("排版结果不是完整布局 JSON").diagnosed(crate::error::Diagnostic::error(
            "layout.parse",
            &error,
            json!({"response":text,"line":error.line(),"column":error.column()}),
        ))
    })?;
    if result.groups.is_empty() || result.groups.iter().any(Vec::is_empty) {
        return Err(invalid("排版包含空语义组"));
    }
    let dropped_set = result.drop_blocks.iter().collect::<HashSet<_>>();
    if dropped_set.len() != result.drop_blocks.len()
        || result
            .drop_blocks
            .iter()
            .any(|id| !document.text_blocks.iter().any(|b| &b.id == id))
    {
        return Err(invalid("删除块编号不存在或重复"));
    }
    let mut used = Vec::new();
    let mut bodies = Vec::new();
    let mut used_images = Vec::new();
    let mut caption_ids = HashSet::new();
    let mut groups: Vec<Group> = Vec::new();
    let mut leading = String::new();
    for blocks in result.groups {
        let mut group = Group::default();
        for block in blocks {
            match block {
                Block::Paragraph { ids } => {
                    if ids.is_empty()
                        || ids.iter().any(|id| {
                            document.text(id).is_none()
                                || document.captions.values().any(|known| known.contains(id))
                        })
                    {
                        return Err(invalid("正文编号无效或误用了图注"));
                    }
                    let paragraph = ids
                        .iter()
                        .filter_map(|id| document.text(id))
                        .collect::<String>();
                    group.length += count(&paragraph);
                    group.paragraphs += 1;
                    group
                        .html
                        .push_str(&format!("<p>{}</p>", escape(&paragraph)));
                    used.extend(ids.clone());
                    bodies.extend(ids);
                }
                Block::Image {
                    id,
                    caption_ids: ids,
                } => {
                    let image = document
                        .images
                        .iter()
                        .find(|(key, _)| key == &id)
                        .ok_or_else(|| invalid("图片编号不存在"))?;
                    if ids.iter().any(|id| document.text(id).is_none()) {
                        return Err(invalid("图注编号不存在"));
                    }
                    let candidate = document
                        .blocks
                        .iter()
                        .position(|block| {
                            block.get("type").and_then(Value::as_str) == Some("image")
                                && block.get("id").and_then(Value::as_str) == Some(&id)
                        })
                        .and_then(|index| document.blocks.get(index + 1))
                        .and_then(|block| block.get("fragments"))
                        .and_then(Value::as_array)
                        .map(|values| {
                            values
                                .iter()
                                .filter_map(Value::as_str)
                                .map(str::to_owned)
                                .collect::<Vec<_>>()
                        })
                        .unwrap_or_default();
                    if document
                        .captions
                        .get(&id)
                        .is_some_and(|known| known != &ids)
                        || (!document.captions.contains_key(&id)
                            && !ids.is_empty()
                            && ids != candidate)
                    {
                        return Err(invalid("图注必须完整绑定原图或紧邻文本块"));
                    }
                    group.html.push_str(&image.1);
                    let caption = clean_caption(
                        &ids.iter()
                            .filter_map(|id| document.text(id))
                            .collect::<String>(),
                    );
                    if !caption.is_empty() {
                        group.html.push_str(&format!(
                            "<p class=\"img-caption\">{}</p>",
                            escape(&caption)
                        ));
                    }
                    caption_ids.extend(ids.clone());
                    used.extend(ids);
                    used_images.push(id);
                }
            }
        }
        if group.paragraphs > 0 {
            group.html = std::mem::take(&mut leading) + &group.html;
            groups.push(group);
        } else if let Some(previous) = groups.last_mut() {
            previous.html.push_str(&group.html);
        } else {
            leading.push_str(&group.html);
        }
    }
    if groups.is_empty() {
        return Err(invalid("排版缺少正文"));
    }
    // 声明删除却完整引用的块优先保留，与旧实现的保守纠正规则一致。
    let dropped = result
        .drop_blocks
        .iter()
        .filter(|id| {
            document
                .text_blocks
                .iter()
                .find(|b| &b.id == *id)
                .is_some_and(|block| !block.ids.iter().all(|id| used.contains(id)))
        })
        .collect::<HashSet<_>>();
    let retained = document
        .text_blocks
        .iter()
        .enumerate()
        .filter(|(_, block)| !dropped.contains(&block.id))
        .map(|(index, _)| index)
        .collect::<Vec<_>>();
    let (Some(&first), Some(&last)) = (retained.first(), retained.last()) else {
        return Err(invalid("不能删除全文"));
    };
    if document.text_blocks[first..=last]
        .iter()
        .any(|b| dropped.contains(&b.id))
    {
        return Err(invalid("不能删除中间正文"));
    }
    let mut removed = HashSet::new();
    for block in &document.text_blocks {
        if dropped.contains(&block.id) {
            let text = block
                .ids
                .iter()
                .filter_map(|id| document.text(id))
                .collect::<String>();
            if text.trim_start().starts_with("来源") && text.contains([':', '：'])
                || block.caption.is_some()
            {
                return Err(invalid("不能删除来源或图注"));
            }
            removed.extend(block.ids.iter().cloned());
        }
    }
    let expected = document
        .texts
        .iter()
        .map(|(id, _)| id.clone())
        .filter(|id| !removed.contains(id))
        .collect::<Vec<_>>();
    if used.len() != used.iter().collect::<HashSet<_>>().len()
        || used.iter().collect::<HashSet<_>>() != expected.iter().collect::<HashSet<_>>()
    {
        return Err(invalid("正文片段遗漏或重复"));
    }
    if bodies
        != expected
            .into_iter()
            .filter(|id| !caption_ids.contains(id))
            .collect::<Vec<_>>()
        || used_images
            != document
                .images
                .iter()
                .map(|(id, _)| id.clone())
                .collect::<Vec<_>>()
    {
        return Err(invalid("正文或图片顺序发生变化"));
    }
    let mut output = pages(&groups, paginate);
    if let Some(source) = &document.source {
        output
            .last_mut()
            .expect("存在正文页")
            .push_str(&format!("<p>{}</p>", escape(source)));
    }
    Ok(with_breaks(&output.join(PAGE_BREAK)))
}

struct OriginalUnit {
    html: String,
    text: String,
    decoration: bool,
}
fn original_units(
    element: ElementRef<'_>,
    wrappers: &[(String, String)],
    units: &mut Vec<OriginalUnit>,
) -> Result<(), HarvestError> {
    let name = element.value().name();
    let caption = element
        .value()
        .classes()
        .any(|class| class == "img-caption");
    let container = matches!(name, "html" | "div" | "section" | "article") && !caption;
    let block_children = element.children().all(|child| match child.value() {
        Node::Text(text) => text.text.replace(PAGE_BREAK, "").trim().is_empty(),
        Node::Comment(_) => true,
        Node::Element(node) => block_tag(node.name()) || matches!(node.name(), "img" | "br" | "hr"),
        _ => false,
    });
    if container
        && !block_children
        && element
            .descendants()
            .filter_map(ElementRef::wrap)
            .any(|child| child.id() != element.id() && block_tag(child.value().name()))
    {
        // 混合散落文本/内联节点与块级段落时不能把整篇伪装成一个成功分页的单元。
        return Err(invalid("正文包含混合段落结构，已跳过分页并保留后台原排版"));
    }
    if container && block_children {
        let mut wrappers = wrappers.to_vec();
        if name != "html" {
            let attrs = element
                .value()
                .attrs()
                .map(|(key, value)| format!(" {key}=\"{}\"", escape(value)))
                .collect::<String>();
            wrappers.push((format!("<{name}{attrs}>"), format!("</{name}>")));
        }
        for child in element.children() {
            match child.value() {
                Node::Element(_) => {
                    original_units(ElementRef::wrap(child).expect("元素节点"), &wrappers, units)?
                }
                Node::Text(text) if text.text.replace(PAGE_BREAK, "").trim().is_empty() => {}
                Node::Comment(_) => {}
                _ => return Err(invalid("正文包含无法安全分页的散落文本")),
            }
        }
    } else {
        let html = element.html();
        let text = plain_text(&html);
        let html = wrappers
            .iter()
            .map(|(open, _)| open.as_str())
            .collect::<String>()
            + &html
            + &wrappers
                .iter()
                .rev()
                .map(|(_, close)| close.as_str())
                .collect::<String>();
        units.push(OriginalUnit {
            html,
            decoration: caption
                || matches!(name, "img" | "br" | "hr" | "figcaption" | "figure")
                || text.is_empty(),
            text,
        });
    }
    Ok(())
}
pub(super) fn paginate_existing(html: &str) -> Result<String, HarvestError> {
    let dom = Html::parse_fragment(html);
    if dom
        .select(&Selector::parse(UNSUPPORTED).expect("固定选择器"))
        .next()
        .is_some()
    {
        return Err(invalid("正文结构无法安全分页，已保留后台原排版"));
    }
    let mut groups: Vec<Group> = Vec::new();
    let mut leading = String::new();
    let mut source = String::new();
    let mut units = Vec::new();
    // 逐层提取容器内原段落，各单元保留原标签及祖先包裹；不因顶层 div 把整篇视作一段。
    original_units(dom.root_element(), &[], &mut units)?;
    for unit in units {
        if SOURCE.is_match(&unit.text) {
            source.push_str(&unit.html);
            continue;
        }
        if unit.decoration {
            if let Some(previous) = groups.last_mut() {
                previous.html.push_str(&unit.html);
            } else {
                leading.push_str(&unit.html);
            }
        } else {
            groups.push(Group {
                html: std::mem::take(&mut leading) + &unit.html,
                length: count(&unit.text),
                paragraphs: 1,
            });
        }
    }
    if groups.is_empty() {
        return Err(invalid("没有可分页的正文"));
    }
    let mut output = pages(&groups, true);
    output.last_mut().expect("存在正文页").push_str(&source);
    Ok(output.join(PAGE_BREAK))
}
