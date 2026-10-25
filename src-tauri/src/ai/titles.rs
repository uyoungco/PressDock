use super::*;
use crate::database::Database;
use std::collections::HashSet;

const VARIABLES: [&str; 5] = ["title", "content", "count", "max_length", "requirements"];

pub(super) fn validate_variables(prompt: &str) -> Result<(), AiError> {
    render(prompt, |name| {
        if VARIABLES.contains(&name) {
            Ok(String::new())
        } else {
            Err(AiError::invalid(format!("未知模板变量：{{{{{name}}}}}")))
        }
    })
    .map(|_| ())
}

// 单次解析，不再次解释素材正文里的 {{...}}，防止变量级联替换。
fn render(
    prompt: &str,
    mut variable: impl FnMut(&str) -> Result<String, AiError>,
) -> Result<String, AiError> {
    let mut output = String::new();
    let mut rest = prompt;
    while let Some(start) = rest.find("{{") {
        output.push_str(&rest[..start]);
        rest = &rest[start + 2..];
        let end = rest
            .find("}}")
            .ok_or_else(|| AiError::invalid("模板变量缺少结束符 }}"))?;
        output.push_str(&variable(rest[..end].trim())?);
        rest = &rest[end + 2..];
    }
    output.push_str(rest);
    Ok(output)
}

pub(super) fn candidates(output: &str, count: u8, max_length: u16) -> Result<Vec<String>, AiError> {
    let output = output.trim();
    let output = if let Some(fenced) = output.strip_prefix("```") {
        let (_, text) = fenced
            .split_once('\n')
            .ok_or_else(|| AiError::new("AI_RESPONSE", "标题结果格式无效，请重新生成"))?;
        text.trim().strip_suffix("```").unwrap_or(text).trim()
    } else {
        output
    };
    let entries: Vec<String> = serde_json::from_str(output)
        .map_err(|_| AiError::new("AI_RESPONSE", "模型没有返回标题数组，请检查模板或重新生成"))?;
    let mut seen = HashSet::new();
    let entries = entries
        .into_iter()
        .map(|s| s.trim().to_owned())
        .filter(|s| {
            !s.is_empty()
                && s.chars().count() <= usize::from(max_length)
                && !s.chars().any(char::is_control)
                && seen.insert(s.clone())
        })
        .take(usize::from(count))
        .collect::<Vec<_>>();
    if entries.is_empty() {
        return Err(AiError::new(
            "AI_NO_CANDIDATES",
            "没有符合字数要求的有效标题，请调整条件后重新生成",
        ));
    }
    Ok(entries)
}

impl AiService {
    pub async fn suggest_titles(
        &self,
        db: &Database,
        r: TitleSuggestionRequest,
    ) -> Result<TitleSuggestionResult, AiError> {
        if r.title.trim().is_empty() && r.content.trim().is_empty() {
            return Err(AiError::invalid("请先填写标题或参考正文"));
        }
        if r.title.chars().count() > 20_000
            || r.content.len() > 4_000_000
            || r.requirements.chars().count() > 2000
        {
            return Err(AiError::invalid(
                "标题、正文或补充要求过长；正文最多 4 MB，补充要求最多 2000 字符",
            ));
        }
        let settings = db.ai_settings().await?;
        let template = settings
            .templates
            .into_iter()
            .find(|t| t.id == r.template_id)
            .ok_or_else(|| AiError::invalid("提示词模板不存在"))?;
        template.validate()?;
        let bound_model = template
            .model_config_id
            .as_ref()
            .ok_or_else(|| AiError::invalid("请先在提示词模板设置中绑定模型"))?;
        let model_id = r.model_config_id.as_ref().unwrap_or(bound_model);
        let model = settings
            .models
            .into_iter()
            .find(|m| m.id == *model_id)
            .ok_or_else(|| AiError::invalid("模型配置不存在"))?;
        let count = r.candidate_count.unwrap_or(template.candidate_count);
        let max_length = r.max_length.unwrap_or(template.max_length);
        rules(count, max_length)?;
        let expand = |name: &str| match name {
            "title" => Ok(r.title.clone()),
            "content" => Ok(r.content.clone()),
            "count" => Ok(count.to_string()),
            "max_length" => Ok(max_length.to_string()),
            "requirements" => Ok(r.requirements.clone()),
            _ => Err(AiError::invalid("未知模板变量")),
        };
        let mut system = render(&template.system_prompt, expand)?;
        system.push_str(&format!("\n输出约定：仅返回 JSON 字符串数组，不含说明、Markdown 或编号。生成 {count} 个不同标题，每个最多 {max_length} 个 Unicode 字符，标点计入。不得编造参考材料中没有的事实。"));
        let user = format!(
            "{}\n\n本次补充要求（不得改变输出格式及事实）：{}",
            render(&template.user_prompt, expand)?,
            r.requirements
        );
        let output = self.generate_text(db, &model, &system, &user).await?;
        Ok(TitleSuggestionResult {
            job_id: r.job_id,
            template_id: template.id,
            model_config_id: model.id,
            candidates: candidates(&output, count, max_length)?,
            requested_count: count,
        })
    }
}
