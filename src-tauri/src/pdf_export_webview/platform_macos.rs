// macOS: not yet implemented — deferred from Windows-first rollout.
// Stub required so the platform dispatch in pdf_export_webview.rs compiles.

#[cfg(target_os = "macos")]
pub(super) fn print_to_pdf(
    _html_path: &std::path::Path,
    _output_path: &str,
) -> Result<(), String> {
    Err("PDF export on macOS is not yet supported".to_string())
}
