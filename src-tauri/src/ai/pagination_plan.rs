//! 两个分页入口共用的 V9 规划；只返回内容块编号，不生成或改写正文。
use super::pagination::{PaginationBlock, PaginationBlockType as Kind, SemanticPagination};
use super::{AiError, PaginationOptions};
use std::collections::{HashMap, HashSet};

// 与 JavaScript 的 /\s/u 一致，包括 BOM、不包括 NEL。
pub(crate) fn whitespace(c: char) -> bool {
    matches!(c, '\t'..='\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}')
}
pub(crate) fn count(text: &str) -> u32 {
    text.chars().filter(|c| !whitespace(*c)).count() as u32
}
fn track_quote(stack: &mut Vec<char>, c: char) -> bool {
    if stack.last() == Some(&c) {
        stack.pop();
        return true;
    }
    if let Some(end) = match c {
        '"' => Some('"'),
        '“' => Some('”'),
        '‘' => Some('’'),
        '「' => Some('」'),
        '『' => Some('』'),
        '（' => Some('）'),
        '(' => Some(')'),
        _ => None,
    } {
        stack.push(end);
    }
    false
}
/// 完整句界的 UTF-8 字节位置；HTML 适配器在文字节点内切分，绝不切 HTML 字符串。
pub(crate) fn sentences(text: &str) -> Vec<usize> {
    let chars: Vec<_> = text.char_indices().collect();
    let mut ends = Vec::new();
    let mut stack = Vec::new();
    let mut pending = false;
    for (i, &(offset, c)) in chars.iter().enumerate() {
        let closing = track_quote(&mut stack, c);
        let next = chars.get(i + 1).map(|&(_, c)| c);
        if matches!(c, '。' | '！' | '？' | '!' | '?') || (c == '.' && next.is_none_or(whitespace))
        {
            pending = true;
        } else if !closing && !whitespace(c) {
            pending = false;
        }
        if pending && stack.is_empty() && next.is_none_or(|c| !"。！？!?”’」』）)\"".contains(c))
        {
            ends.push(offset + c.len_utf8());
            pending = false;
        }
    }
    if ends.last() != Some(&text.len()) {
        ends.push(text.len());
    }
    ends
}

pub(crate) fn plan(
    blocks: &[PaginationBlock],
    semantic: &SemanticPagination,
    options: &PaginationOptions,
) -> Result<Vec<String>, AiError> {
    options.validate()?;
    super::pagination::validate_semantic(semantic, blocks)?;
    if blocks.is_empty() {
        return Ok(Vec::new());
    }
    let mut bound: HashSet<&str> = semantic.bind_after.iter().map(String::as_str).collect();
    let preferred: HashSet<&str> = semantic.prefer_after.iter().map(String::as_str).collect();
    let positions: HashMap<&str, usize> = blocks
        .iter()
        .enumerate()
        .map(|(i, b)| (b.id.as_str(), i))
        .collect();
    for (i, block) in blocks.iter().enumerate() {
        if let Some(&image) = block.caption_of.as_deref().and_then(|id| positions.get(id))
            && image < i
        {
            for b in &blocks[image..i] {
                bound.insert(&b.id);
            }
        }
        if block.keep_with_next == Some(true) {
            let mut next = i;
            loop {
                bound.insert(&blocks[next].id);
                next += 1;
                if next >= blocks.len()
                    || blocks[next].chars > 0
                    || blocks[next].r#type == Kind::Image
                {
                    break;
                }
            }
        }
    }
    let mut prefix = vec![0_u64];
    let mut body = vec![0_u32];
    for b in blocks {
        prefix.push(prefix.last().unwrap() + u64::from(b.chars));
        body.push(
            body.last().unwrap()
                + u32::from(matches!(b.r#type, Kind::Text | Kind::Caption) && b.chars > 0),
        );
    }
    if body.last() == Some(&0) {
        return Ok(Vec::new());
    }
    let mut ends = vec![0];
    let mut stack = Vec::new();
    for (i, b) in blocks.iter().enumerate() {
        for c in b.text.as_deref().unwrap_or("").chars() {
            track_quote(&mut stack, c);
        }
        if i + 1 < blocks.len()
            && !bound.contains(b.id.as_str())
            && b.keep_with_next != Some(true)
            && !matches!(b.r#type, Kind::Heading | Kind::Source)
            && !matches!(blocks[i + 1].r#type, Kind::Caption | Kind::Source)
            && stack.is_empty()
            && prefix[i + 1] >= u64::from(options.min_chars)
            && prefix.last().unwrap() - prefix[i + 1] >= u64::from(options.min_chars)
        {
            ends.push(i + 1);
        }
    }
    ends.push(blocks.len());
    let mut costs = vec![f64::INFINITY; ends.len()];
    let mut parents = vec![None; ends.len()];
    costs[0] = 0.0;
    let penalty = 1_000_000_f64.max(f64::from(options.max_chars).powi(2) * 10.0);
    for end in 1..ends.len() {
        for start in 0..end {
            let (from, to) = (ends[start], ends[end]);
            if body[to] == body[from] {
                continue;
            }
            let length = prefix[to] - prefix[from];
            let paragraph_cut =
                to < blocks.len() && blocks[to - 1].paragraph == blocks[to].paragraph;
            let score = costs[start]
                + (length as f64 - f64::from(options.target_chars)).powi(2)
                + if length < u64::from(options.min_chars) || length > u64::from(options.max_chars)
                {
                    penalty
                } else {
                    0.0
                }
                + if paragraph_cut { 500.0 } else { 0.0 }
                - if preferred.contains(blocks[to - 1].id.as_str()) {
                    1000.0
                } else {
                    0.0
                };
            if score < costs[end] {
                costs[end] = score;
                parents[end] = Some(start);
            }
        }
    }
    let mut breaks = Vec::new();
    let mut cursor = ends.len() - 1;
    while let Some(parent) = parents[cursor].filter(|p| *p > 0) {
        breaks.push(blocks[ends[parent] - 1].id.clone());
        cursor = parent;
    }
    breaks.reverse();
    Ok(breaks)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    #[test]
    fn research_examples_match_existing_v9_boundaries() {
        let fixtures: Vec<Value> = serde_json::from_str(include_str!(
            "../../../docs/ai-pagination/demo-fixtures.json"
        ))
        .unwrap();
        for f in fixtures {
            let blocks: Vec<PaginationBlock> = serde_json::from_value(f["blocks"].clone()).unwrap();
            let forbidden: Vec<String> =
                serde_json::from_value(f.get("forbid").cloned().unwrap_or(serde_json::json!([])))
                    .unwrap();
            let semantic = SemanticPagination {
                bind_after: forbidden.clone(),
                prefer_after: vec![],
            };
            let breaks = plan(
                &blocks,
                &semantic,
                &PaginationOptions {
                    min_chars: 100,
                    target_chars: 240,
                    max_chars: 400,
                },
            )
            .unwrap();
            assert!(
                breaks.iter().all(|id| !forbidden.contains(id)),
                "{}",
                f["id"]
            );
            if let Some(expected) = f.get("expectedBreaks") {
                assert_eq!(
                    serde_json::to_value(breaks).unwrap(),
                    *expected,
                    "{}",
                    f["id"]
                );
            }
        }
    }
}
