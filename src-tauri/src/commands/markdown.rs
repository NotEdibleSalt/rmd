use crate::markdown::{self, MarkdownOutput};

#[tauri::command]
pub fn parse_markdown(source: &str) -> Result<MarkdownOutput, String> {
    Ok(markdown::parse(source))
}
