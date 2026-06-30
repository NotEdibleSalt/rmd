use std::path::Path;
use std::sync::LazyLock;
use std::time::Duration;

use tauri::AppHandle;
use tokio::sync::Mutex as TokioMutex;

// ---------------------------------------------------------------------------
// Platform module dispatch
// ---------------------------------------------------------------------------

mod platform_windows;
mod platform_macos;
mod platform_linux;

#[cfg(target_os = "windows")]
use platform_windows::print_to_pdf as platform_print;

#[cfg(target_os = "macos")]
use platform_macos::print_to_pdf as platform_print;

#[cfg(target_os = "linux")]
use platform_linux::print_to_pdf as platform_print;

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
compile_error!("Unsupported target: PDF export requires Windows, macOS, or Linux");

// ---------------------------------------------------------------------------
// Global export lock — serialise concurrent exports
// ---------------------------------------------------------------------------

static EXPORT_LOCK: LazyLock<TokioMutex<()>> = LazyLock::new(|| TokioMutex::new(()));

// ---------------------------------------------------------------------------
// Tauri command
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn export_pdf_webview(
    app: AppHandle,
    html: String,
    output_path: String,
    large_images: Vec<String>,
) -> Result<(), String> {
    let _guard = EXPORT_LOCK.lock().await;

    tokio::time::timeout(Duration::from_secs(60), async {
        export_pdf_webview_impl(app, html, output_path, large_images).await
    })
    .await
    .map_err(|_| "PDF export timed out after 60 seconds".to_string())?
}

// ---------------------------------------------------------------------------
// Inner implementation
// ---------------------------------------------------------------------------

async fn export_pdf_webview_impl(
    _app: AppHandle,
    html: String,
    output_path: String,
    large_images: Vec<String>,
) -> Result<(), String> {
    // 1. Temp directory
    let id = uuid::Uuid::new_v4();
    let temp_dir = std::env::temp_dir().join(format!("rmd-pdf-{id}"));
    std::fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;
    let html_path = temp_dir.join("export.html");

    // 2. Write HTML + copy large images (replacing placeholders)
    write_html_with_images(&html, &html_path, &temp_dir, &large_images)?;

    // 3. Delegate to platform-specific print (creates its own hidden
    //    WebView2 on Windows, or returns error on macOS/Linux stubs)
    let result = platform_print(&html_path, &output_path);

    // 4. Cleanup — retry deletion up to 3 times (Windows file-locking)
    for attempt in 0..3 {
        if std::fs::remove_dir_all(&temp_dir).is_ok() {
            break;
        }
        if attempt < 2 {
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }

    result
}

// ---------------------------------------------------------------------------
// HTML + image writing helper
// ---------------------------------------------------------------------------

fn write_html_with_images(
    html: &str,
    html_path: &Path,
    temp_dir: &Path,
    large_images: &[String],
) -> Result<(), String> {
    if large_images.is_empty() {
        std::fs::write(html_path, html).map_err(|e| e.to_string())
    } else {
        let images_dir = temp_dir.join("images");
        std::fs::create_dir_all(&images_dir).map_err(|e| e.to_string())?;
        let mut result = html.to_string();

        for entry in large_images {
            let mut parts = entry.splitn(2, '|');
            let placeholder = parts.next().unwrap_or("");
            let src_path = parts.next().unwrap_or("");
            if placeholder.is_empty() || src_path.is_empty() {
                continue;
            }
            let src = std::path::Path::new(src_path);
            if let Some(file_name) = src.file_name().and_then(|n| n.to_str()) {
                let dest = images_dir.join(file_name);
                let _ = std::fs::copy(src, &dest);
                result = result.replace(placeholder, &format!("./images/{file_name}"));
            }
        }

        std::fs::write(html_path, &result).map_err(|e| e.to_string())
    }
}
