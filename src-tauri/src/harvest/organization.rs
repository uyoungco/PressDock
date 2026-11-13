//! 将 AI 的结构建议映射回本地 HTML；文字、媒体和来源始终来自输入。
use super::{HarvestError, pagination::LocalNode};
use crate::ai::pagination_plan::{count, sentences, whitespace};
use crate::ai::{BodyPlan, OrganizationSnapshot};
use scraper::Html;
use serde::Serialize;
use std::collections::{HashMap, HashSet};

#[derive(Serialize)]
pub(crate) struct Sentence {
    id: String,
    text: String,
    chars: u32,
    #[serde(skip)]
    end: usize,
}
#[derive(Serialize)]
pub(crate) struct Block {
    id: String,
    kind: &'static str,
    text: String,
    chars: u32,
    sentences: Vec<Sentence>,
    section: usize,
}
#[derive(Serialize)]
pub(crate) struct Anchor {
    block_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    sentence_id: Option<String>,
}
#[derive(Serialize)]
pub(crate) struct Group {
    id: String,
    block_ids: Vec<String>,
    allowed_after: Vec<Anchor>,
    #[serde(skip)]
    start: usize,
    #[serde(skip)]
    end: usize,
}
struct Unit {
    node: LocalNode,
    tail: String,
}
#[derive(Serialize)]
struct Action {
    id: String,
    kind: &'static str,
    block_ids: Vec<String>,
    paragraphs: Vec<String>,
    #[serde(skip)]
    plan: BodyPlan,
}
#[derive(Serialize)]
pub(crate) struct Document {
    pub blocks: Vec<Block>,
    pub groups: Vec<Group>,
    pub joinable_after: Vec<String>,
    pub splittable_after: Vec<Anchor>,
    actions: Vec<Action>,
    #[serde(skip)]
    original: String,
    #[serde(skip)]
    prefix: String,
    #[serde(skip)]
    units: Vec<Unit>,
}
fn invalid() -> HarvestError {
    HarvestError::new("AI_BODY_RESPONSE", "正文整理结果无效，保留整理前排版")
}
fn source(text: &str) -> bool {
    let text = text.chars().filter(|c| !whitespace(*c)).collect::<String>();
    [
        "来源",
        "记者",
        "编辑",
        "责编",
        "审核",
        "校对",
        "红星新闻记者",
    ]
    .iter()
    .any(|prefix| text.starts_with(prefix))
}
fn caption(node: &LocalNode) -> bool {
    node.caption()
        || (node.name() == "p"
            && ["▲", "△", "图：", "图:", "图片来源", "图源："]
                .iter()
                .any(|prefix| node.text().trim_matches(whitespace).starts_with(prefix)))
}

pub(crate) fn prepare(html: &str) -> Result<Document, HarvestError> {
    if html.len() > 4_000_000 {
        return Err(HarvestError::invalid("正文整理最多 4 MB，不会截断原文"));
    }
    let root = LocalNode::element(Html::parse_fragment(html).root_element(), 0)?;
    let LocalNode::Element { children, .. } = root else {
        unreachable!()
    };
    let mut result = Document {
        blocks: vec![],
        groups: vec![],
        joinable_after: vec![],
        splittable_after: vec![],
        actions: vec![],
        original: html.into(),
        prefix: String::new(),
        units: vec![],
    };
    let mut section = 0;
    for node in children {
        if !node.compatible() || node.nested_marker() {
            return Err(HarvestError::invalid("正文结构不支持安全整理，保留原排版"));
        }
        if matches!(node, LocalNode::Text(_) | LocalNode::Comment(_)) || node.name() == "br" {
            if node.text().chars().any(|c| !whitespace(c)) {
                return Err(HarvestError::invalid("正文包含未分段文字，保留原排版"));
            }
            if let Some(unit) = result.units.last_mut() {
                unit.tail.push_str(&node.render());
            } else {
                result.prefix.push_str(&node.render());
            }
            continue;
        }
        if !matches!(
            node.name(),
            "p" | "img"
                | "h1"
                | "h2"
                | "h3"
                | "h4"
                | "h5"
                | "h6"
                | "blockquote"
                | "ul"
                | "ol"
                | "pre"
                | "hr"
        ) {
            return Err(HarvestError::invalid("正文结构不支持安全整理，保留原排版"));
        }
        let text = node.text();
        let heading = matches!(node.name(), "h1" | "h2" | "h3" | "h4" | "h5" | "h6");
        let kind = if node.marker() {
            "page"
        } else if heading {
            "heading"
        } else if node.image() && text.trim_matches(whitespace).is_empty() {
            "image"
        } else if caption(&node) {
            "caption"
        } else if source(&text) {
            "source"
        } else if node.name() == "p" && node.only_text() {
            "text"
        } else {
            "protected"
        };
        if matches!(kind, "heading" | "source" | "page" | "protected") {
            section += 1;
        }
        let ends = if kind == "text" && count(&text) >= 100 {
            sentences(&text)
        } else {
            vec![text.len()]
        };
        let mut from = 0;
        let sentence_list = ends
            .iter()
            .enumerate()
            .map(|(i, &end)| {
                let part = text[from..end].to_owned();
                from = end;
                Sentence {
                    id: format!("S{}", i + 1),
                    chars: count(&part),
                    text: part,
                    end,
                }
            })
            .collect();
        result.blocks.push(Block {
            id: format!("B{}", result.blocks.len() + 1),
            kind,
            chars: count(&text),
            text,
            sentences: sentence_list,
            section,
        });
        result.units.push(Unit {
            node,
            tail: String::new(),
        });
        if matches!(kind, "heading" | "source" | "page" | "protected") {
            section += 1;
        }
        if result.blocks.len() > 10_000 {
            return Err(HarvestError::invalid("正文整理内容块最多 10000 个"));
        }
    }
    let mut i = 0;
    while i < result.blocks.len() {
        if result.blocks[i].kind != "image" {
            i += 1;
            continue;
        }
        let start = i;
        let mut end = i + 1;
        while end < result.blocks.len() && result.blocks[end].kind == "caption" {
            end += 1;
        }
        let section = result.blocks[start].section;
        let mut allowed_after = Vec::new();
        // 仅在邻近正文内调位，不跨小节、来源、分页或另一张图片。
        let left = (0..start)
            .rev()
            .find(|&j| result.blocks[j].section != section || result.blocks[j].kind == "image")
            .map_or(0, |j| j + 1)
            .max(start.saturating_sub(2));
        let right = (end..result.blocks.len())
            .find(|&j| result.blocks[j].section != section || result.blocks[j].kind == "image")
            .unwrap_or(result.blocks.len())
            .min(end + 2);
        for j in left..right {
            let b = &result.blocks[j];
            if b.kind != "text" || b.section != section || (start..end).contains(&j) {
                continue;
            }
            allowed_after.push(Anchor {
                block_id: b.id.clone(),
                sentence_id: None,
            });
            for s in b.sentences.iter().take(b.sentences.len().saturating_sub(1)) {
                allowed_after.push(Anchor {
                    block_id: b.id.clone(),
                    sentence_id: Some(s.id.clone()),
                });
            }
        }
        result.groups.push(Group {
            id: format!("G{}", result.groups.len() + 1),
            block_ids: result.blocks[start..end]
                .iter()
                .map(|b| b.id.clone())
                .collect(),
            allowed_after,
            start,
            end,
        });
        i = end;
    }
    if result.blocks.is_empty() {
        return Err(HarvestError::invalid("正文为空，无法整理"));
    }
    for i in 0..result.blocks.len() - 1 {
        let (a, b) = (&result.blocks[i], &result.blocks[i + 1]);
        if a.kind == "text"
            && b.kind == "text"
            && a.section == b.section
            && count(&a.text) <= 160
            // 缺句号也可能是小标题或没有 class 的图注。只修复可见的续句标点边界。
            && (a.text.trim_end_matches(whitespace).ends_with(['，', ',', '；', ';', '、'])
                || b.text.trim_start_matches(whitespace).starts_with(['，', ',', '；', ';', '。', '！', '？', '!', '?', '、']))
            && !a
                .text
                .trim_end_matches(whitespace)
                .ends_with(['。', '！', '？', '!', '?', '”', '」', '』', ':', '：'])
            && result.units[i]
                .node
                .joined(&result.units[i + 1].node)
                .is_some()
        {
            result.joinable_after.push(a.id.clone());
        }
    }
    for b in &result.blocks {
        if b.kind != "text" {
            continue;
        }
        for s in b.sentences.iter().take(b.sentences.len().saturating_sub(1)) {
            if count(&b.text[..s.end]) >= 30 && count(&b.text[s.end..]) >= 30 {
                result.splittable_after.push(Anchor {
                    block_id: b.id.clone(),
                    sentence_id: Some(s.id.clone()),
                });
            }
        }
    }
    result.build_actions();
    Ok(result)
}

impl Document {
    fn build_actions(&mut self) {
        let empty = || BodyPlan {
            version: 1,
            actions: vec![],
            join_after: vec![],
            split_after: vec![],
            move_groups: vec![],
        };
        let terminal = |t: &str| {
            t.trim_end_matches(whitespace)
                .ends_with(['。', '！', '？', '!', '?', '”', '」', '』'])
        };
        let mut occupied = HashSet::new();
        let mut i = 0;
        while i + 1 < self.blocks.len() {
            if !self.joinable_after.contains(&self.blocks[i].id) {
                i += 1;
                continue;
            }
            let mut end = i;
            let mut text = self.blocks[i].text.clone();
            let mut plan = empty();
            while self.joinable_after.contains(&self.blocks[end].id) && end + 1 < self.blocks.len()
            {
                if count(&text) + self.blocks[end + 1].chars > 200 {
                    break;
                }
                plan.join_after.push(self.blocks[end].id.clone());
                end += 1;
                text.push_str(&self.blocks[end].text);
                if terminal(&text) {
                    break;
                }
            }
            if end > i && terminal(&text) {
                occupied.extend(i..=end);
                self.actions.push(Action {
                    id: format!("A{}", self.actions.len() + 1),
                    kind: "join",
                    block_ids: self.blocks[i..=end].iter().map(|b| b.id.clone()).collect(),
                    paragraphs: vec![text],
                    plan,
                });
                i = end + 1;
            } else {
                i += 1;
            }
        }
        for (i, b) in self.blocks.iter().enumerate() {
            if occupied.contains(&i) || b.kind != "text" || b.chars <= 160 || !terminal(&b.text) {
                continue;
            }
            let mut from = 0;
            let mut plan = empty();
            let mut paragraphs = Vec::new();
            while count(&b.text[from..]) > 160 {
                let candidate = b
                    .sentences
                    .iter()
                    .take(b.sentences.len().saturating_sub(1))
                    .filter(|s| {
                        s.end > from
                            && count(&b.text[from..s.end]) >= 40
                            && count(&b.text[s.end..]) >= 40
                    })
                    .min_by_key(|s| count(&b.text[from..s.end]).abs_diff(120));
                let Some(s) = candidate else {
                    break;
                };
                paragraphs.push(b.text[from..s.end].to_owned());
                plan.split_after.push(crate::ai::organization::BodySplit {
                    block_id: b.id.clone(),
                    sentence_id: s.id.clone(),
                });
                from = s.end;
            }
            if from > 0 {
                paragraphs.push(b.text[from..].to_owned());
                self.actions.push(Action {
                    id: format!("A{}", self.actions.len() + 1),
                    kind: "split",
                    block_ids: vec![b.id.clone()],
                    paragraphs,
                    plan,
                });
            }
        }
    }
    pub(crate) fn input(&self) -> Result<String, HarvestError> {
        let blocks: Vec<_> = self
            .blocks
            .iter()
            .map(|b| serde_json::json!({"id":b.id,"kind":b.kind,"text":b.text,"chars":b.chars}))
            .collect();
        Ok(serde_json::to_string(
            &serde_json::json!({"blocks":blocks,"actions":self.actions}),
        )?)
    }
    pub(crate) fn needs_ai(&self) -> bool {
        !self.actions.is_empty()
    }
    pub(crate) fn apply(&self, plan: &BodyPlan) -> Result<String, HarvestError> {
        if plan.version == 2 {
            if !plan.join_after.is_empty()
                || !plan.split_after.is_empty()
                || !plan.move_groups.is_empty()
            {
                return Err(invalid());
            }
            let mut expanded = BodyPlan {
                version: 1,
                actions: vec![],
                join_after: vec![],
                split_after: vec![],
                move_groups: vec![],
            };
            let mut seen = HashSet::new();
            for id in &plan.actions {
                if !seen.insert(id) {
                    return Err(invalid());
                }
                let a = self
                    .actions
                    .iter()
                    .find(|a| &a.id == id)
                    .ok_or_else(invalid)?;
                expanded
                    .join_after
                    .extend(a.plan.join_after.iter().cloned());
                expanded
                    .split_after
                    .extend(a.plan.split_after.iter().cloned());
                expanded
                    .move_groups
                    .extend(a.plan.move_groups.iter().cloned());
            }
            return self.apply(&expanded);
        }
        if !plan.actions.is_empty() {
            return Err(invalid());
        }
        if plan.version != 1 {
            return Err(invalid());
        }
        if plan.join_after.is_empty() && plan.split_after.is_empty() && plan.move_groups.is_empty()
        {
            return Ok(self.original.clone());
        }
        let positions: HashMap<_, _> = self
            .blocks
            .iter()
            .enumerate()
            .map(|(i, b)| (b.id.as_str(), i))
            .collect();
        let mut joins = HashSet::new();
        let mut joined_units = HashSet::new();
        for id in &plan.join_after {
            let i = *positions.get(id.as_str()).ok_or_else(invalid)?;
            if !self.joinable_after.contains(id) || !joins.insert(i) {
                return Err(invalid());
            }
            joined_units.extend([i, i + 1]);
        }
        let mut splits: HashMap<usize, Vec<(usize, String)>> = HashMap::new();
        let mut seen = HashSet::new();
        for split in &plan.split_after {
            let i = *positions.get(split.block_id.as_str()).ok_or_else(invalid)?;
            if joined_units.contains(&i) {
                return Err(invalid());
            }
            let block = &self.blocks[i];
            let s = block
                .sentences
                .iter()
                .take(block.sentences.len().saturating_sub(1))
                .find(|s| s.id == split.sentence_id)
                .ok_or_else(invalid)?;
            if block.kind != "text" || !seen.insert((i, s.end)) {
                return Err(invalid());
            }
            splits.entry(i).or_default().push((s.end, s.id.clone()));
        }
        for (&i, points) in &mut splits {
            points.sort_by_key(|p| p.0);
            let mut from = 0;
            for to in points
                .iter()
                .map(|p| p.0)
                .chain(std::iter::once(self.blocks[i].text.len()))
            {
                if count(&self.blocks[i].text[from..to]) < 30 {
                    return Err(invalid());
                }
                from = to;
            }
        }
        let mut destinations: HashMap<(usize, Option<String>), usize> = HashMap::new();
        let mut moved = HashSet::new();
        for operation in &plan.move_groups {
            let g = self
                .groups
                .iter()
                .position(|g| g.id == operation.group_id)
                .ok_or_else(invalid)?;
            let group = &self.groups[g];
            let i = *positions
                .get(operation.after_block_id.as_str())
                .ok_or_else(invalid)?;
            if joined_units.contains(&i) {
                return Err(invalid());
            }
            if !moved.insert(g)
                || !group.allowed_after.iter().any(|a| {
                    a.block_id == operation.after_block_id
                        && a.sentence_id == operation.after_sentence_id
                })
            {
                return Err(invalid());
            }
            if let Some(id) = &operation.after_sentence_id
                && !splits.get(&i).is_some_and(|s| s.iter().any(|p| &p.1 == id))
            {
                return Err(invalid());
            }
            if destinations
                .insert((i, operation.after_sentence_id.clone()), g)
                .is_some()
            {
                return Err(invalid());
            }
        }
        let mut output = self.prefix.clone();
        let mut emitted = Vec::new();
        let moved_units: HashSet<_> = moved
            .iter()
            .flat_map(|&g| self.groups[g].start..self.groups[g].end)
            .collect();
        let emit_group = |g: usize, out: &mut String, emitted: &mut Vec<usize>| {
            for i in self.groups[g].start..self.groups[g].end {
                out.push_str(&self.units[i].node.render());
                out.push_str(&self.units[i].tail);
            }
            emitted.push(g);
        };
        for (i, unit) in self.units.iter().enumerate() {
            if moved_units.contains(&i) {
                continue;
            }
            if i > 0 && joins.contains(&(i - 1)) {
                continue;
            }
            if joins.contains(&i) {
                let mut merged = unit.node.clone();
                let mut end = i;
                while joins.contains(&end) {
                    end += 1;
                    merged = merged.joined(&self.units[end].node).ok_or_else(invalid)?;
                }
                if count(&merged.text()) > 200 {
                    return Err(invalid());
                }
                output.push_str(&merged.render());
                output.push_str(&self.units[end].tail);
                continue;
            }
            let mut start = 0;
            if let Some(points) = splits.get(&i) {
                for (end, id) in points {
                    output.push_str(&unit.node.slice(start, *end));
                    if let Some(&g) = destinations.get(&(i, Some(id.clone()))) {
                        emit_group(g, &mut output, &mut emitted);
                    }
                    start = *end;
                }
            }
            if start == 0 {
                output.push_str(&unit.node.render());
            } else {
                output.push_str(&unit.node.slice(start, unit.node.text().len()));
            }
            output.push_str(&unit.tail);
            if let Some(&g) = destinations.get(&(i, None)) {
                emit_group(g, &mut output, &mut emitted);
            }
            if let Some(g) = self.groups.iter().position(|g| g.start == i) {
                emitted.push(g);
            }
        }
        // 所有媒体组合恰好一次，且组合间顺序不变；无法保证时整步拒绝。
        if emitted != (0..self.groups.len()).collect::<Vec<_>>() {
            return Err(invalid());
        }
        Ok(output)
    }
}

pub(crate) async fn organize(
    ai: &crate::ai::AiService,
    snapshot: &OrganizationSnapshot,
    title: &str,
    html: &str,
) -> Result<String, HarvestError> {
    if snapshot.contract_version != 2 {
        return Err(invalid());
    }
    let document = prepare(html)?;
    if !document.needs_ai() {
        return Ok(html.into());
    }
    let input = document.input()?;
    let (system, user) = crate::ai::organization::render_prompts(
        &snapshot.system_prompt,
        &snapshot.user_prompt,
        title,
        &input,
    )?;
    let output = super::content::generate(
        ai,
        &snapshot.execution,
        &system,
        &user,
        crate::ai::GenerationTask::Organization(None),
    )
    .await?;
    let plan = crate::ai::organization::parse(&output).map_err(|_| invalid())?;
    if plan.version != snapshot.contract_version {
        return Err(invalid());
    }
    document.apply(&plan)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn plan(value: serde_json::Value) -> BodyPlan {
        serde_json::from_value(value).unwrap()
    }
    #[test]
    fn preserves_inline_html_unicode_media_and_caption_when_splitting_and_moving() {
        let text = format!(
            "{}。{}。",
            "演示甲🙂 & 乙".repeat(14),
            "演示后续".repeat(16)
        );
        let html = format!(
            "<p><strong>{}</strong></p><p><img src=\"https://example.com/demo.png\"></p><p class=\"img-caption\">演示图注</p><p>来源：演示</p>",
            text.replace('&', "&amp;")
        );
        let d = prepare(&html).unwrap();
        let out=d.apply(&plan(json!({"version":1,"split_after":[{"block_id":"B1","sentence_id":"S1"}],"move_groups":[{"group_id":"G1","after_block_id":"B1","after_sentence_id":"S1"}]}))).unwrap();
        assert!(out.contains("</strong></p><p><img"));
        assert!(out.contains("演示图注</p><p><strong>演示后续"));
        let parsed = Html::parse_fragment(&out);
        assert_eq!(
            parsed.root_element().text().collect::<String>(),
            format!(
                "{}演示图注{}来源：演示",
                text.split_once('。').unwrap().0.to_owned() + "。",
                text.split_once('。').unwrap().1
            )
        );
        assert_eq!(
            parsed
                .select(&scraper::Selector::parse("img").unwrap())
                .count(),
            1
        );
    }
    #[test]
    fn no_op_preserves_original_bytes_and_rejects_unknown_duplicate_and_cross_section_operations() {
        let html = " <p>演示原始&nbsp;文字。</p>\n<p><img src='https://example.com/demo.png'></p><h2>演示小节</h2><p>演示新小节。</p>";
        let d = prepare(html).unwrap();
        assert_eq!(
            d.apply(&plan(
                json!({"version":1,"split_after":[],"move_groups":[]})
            ))
            .unwrap(),
            html
        );
        for p in [
            json!({"version":1,"split_after":[{"block_id":"B99","sentence_id":"S1"}],"move_groups":[]}),
            json!({"version":1,"split_after":[],"move_groups":[{"group_id":"G1","after_block_id":"B4"}]}),
            json!({"version":3,"split_after":[],"move_groups":[]}),
        ] {
            assert!(d.apply(&plan(p)).is_err());
        }
    }
    #[test]
    fn unsafe_structures_and_nested_page_markers_are_protected() {
        assert!(prepare("<table><tr><td>演示</td></tr></table>").is_err());
        assert!(prepare("<blockquote><p>[!--empirenews.page--]</p></blockquote>").is_err());
        let d=prepare("<p><img src='https://example.com/demo.png'></p><p>▲演示图注</p><p>[!--empirenews.page--]</p><p>演示下一页。</p>").unwrap();
        assert!(d.groups[0].allowed_after.is_empty());
    }
    #[test]
    fn joins_only_compatible_adjacent_text_without_changing_inline_content() {
        let d = prepare(
            "<p><strong>演示前半句，</strong></p><br><p>演示后半句。</p><br><p>来源：演示</p>",
        )
        .unwrap();
        let out = d
            .apply(&plan(
                json!({"version":1,"join_after":["B1"],"split_after":[],"move_groups":[]}),
            ))
            .unwrap();
        assert_eq!(
            out,
            "<p><strong>演示前半句，</strong>演示后半句。</p><br><p>来源：演示</p>"
        );
        assert!(
            d.apply(&plan(
                json!({"version":1,"join_after":["B2"],"split_after":[],"move_groups":[]})
            ))
            .is_err()
        );
        assert!(
            d.apply(&plan(
                json!({"version":1,"join_after":["B1","B1"],"split_after":[],"move_groups":[]})
            ))
            .is_err()
        );
    }
    #[test]
    fn frozen_candidate_choices_compose_without_changing_text_media_or_page_markers() {
        let html = format!(
            "<p>【演示数据】前半句，</p><p>后半句。</p><p>{}。{}。{}。</p><p><img src='https://example.com/demo.png' alt='演示'></p><p class='img-caption'>演示图注</p><p>[!--empirenews.page--]</p><p>来源：演示</p>",
            "演示第一事件".repeat(12),
            "演示第二事件".repeat(12),
            "演示第三事件".repeat(12)
        );
        let d = prepare(&html).unwrap();
        assert_eq!(d.actions.len(), 2);
        let plan =
            crate::ai::organization::parse(r#"{"version":2,"actions":["A1","A2"]}"#).unwrap();
        let output = d.apply(&plan).unwrap();
        let text = |s: &str| {
            Html::parse_fragment(s)
                .root_element()
                .text()
                .collect::<String>()
        };
        assert_eq!(text(&output), text(&html));
        assert_eq!(output.matches("<img ").count(), 1);
        assert_eq!(output.matches("[!--empirenews.page--]").count(), 1);
        for value in [
            r#"{"version":2,"actions":["A1","A1"]}"#,
            r#"{"version":2,"actions":["A999"]}"#,
        ] {
            assert!(
                d.apply(&crate::ai::organization::parse(value).unwrap())
                    .is_err()
            );
        }
        for value in [
            r#"{"version":2,"actions":[],"html":"篡改"}"#,
            r#"{"version":2,"actions":[],"split_after":[]}"#,
            r#"{"version":1,"actions":[]}"#,
            r#"{"actions":[]}"#,
        ] {
            assert!(crate::ai::organization::parse(value).is_err());
        }
    }
    #[test]
    fn unpunctuated_headings_and_unmarked_captions_are_not_join_candidates() {
        let html = "<p>【演示数据】小标题</p><p>演示正文完整句。</p><p><img src='https://example.com/demo.png'></p><p>【演示数据】人物说明</p><p>另一段完整句。</p><p>来 源：演示</p>";
        let doc = prepare(html).unwrap();
        assert!(!doc.needs_ai());
        assert_eq!(doc.blocks.last().unwrap().kind, "source");
    }
}
