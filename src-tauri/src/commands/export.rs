use crate::export;
use tauri::AppHandle;

#[tauri::command]
pub fn export_html(source: &str, title: &str, theme: &str, base_path: &str, markdown_theme_css: Option<&str>) -> Result<String, String> {
    export::export_to_html(source, title, theme, base_path, markdown_theme_css.unwrap_or(""))
}

#[tauri::command]
pub async fn export_pdf(
    app: AppHandle,
    source: String,
    output_path: String,
    base_path: String,
    theme: String,
    markdown_theme_css: Option<String>,
) -> Result<(), String> {
    // Build HTML from source (reuses export_to_html for consistent rendering)
    let html = export::export_to_html(
        &source,
        "PDF Export",
        &theme,
        &base_path,
        markdown_theme_css.as_deref().unwrap_or(""),
    )?;
    // Delegate to webview-based PDF export
    crate::pdf_export_webview::export_pdf_webview(app, html, output_path, vec![]).await
}

#[tauri::command]
pub fn export_docx(source: &str, output_path: &str, base_path: &str, theme_options: Option<&str>) -> Result<(), String> {
    export::export_to_docx(source, output_path, base_path, theme_options.unwrap_or(""))
}
