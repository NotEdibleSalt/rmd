use crate::export;

#[tauri::command]
pub fn export_html(source: &str, title: &str, theme: &str, base_path: &str, markdown_theme_css: Option<&str>) -> Result<String, String> {
    export::export_to_html(source, title, theme, base_path, markdown_theme_css.unwrap_or(""))
}

#[tauri::command]
pub fn export_pdf(source: &str, output_path: &str, base_path: &str, theme: &str, markdown_theme_css: Option<&str>) -> Result<(), String> {
    export::export_to_pdf(source, output_path, base_path, theme, markdown_theme_css.unwrap_or(""))
}

#[tauri::command]
pub fn export_docx(source: &str, output_path: &str, base_path: &str) -> Result<(), String> {
    export::export_to_docx(source, output_path, base_path)
}
