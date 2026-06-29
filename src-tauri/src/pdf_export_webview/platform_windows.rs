use std::path::Path;
use std::process::Command;
use std::time::Duration;

#[cfg(target_os = "windows")]
pub(super) fn print_to_pdf(
    html_path: &Path,
    output_path: &str,
) -> Result<(), String> {
    // Locate Microsoft Edge (installed on all Windows 10/11 systems)
    let edge_path = locate_edge()?;

    // Build file:// URL for the local HTML file
    let url = format!("file:///{}", html_path.to_string_lossy().replace('\\', "/"));

    // Run Edge headless to print to PDF
    let output = Command::new(&edge_path)
        .args([
            "--headless",
            "--disable-gpu",
            "--no-first-run",
            "--disable-sync",
            "--disable-extensions",
            &format!("--print-to-pdf={}", output_path),
            &url,
        ])
        .output()
        .map_err(|e| format!("Failed to launch Edge: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        return Err(format!(
            "Edge headless PDF export failed.\nstderr: {stderr}\nstdout: {stdout}"
        ));
    }

    // Poll until file size stabilises (Edge may still be flushing after exit)
    let mut prev_len = 0u64;
    let mut stable_count = 0u8;
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    loop {
        if let Ok(meta) = std::fs::metadata(output_path) {
            let len = meta.len();
            if len >= 10 && len == prev_len {
                stable_count += 1;
                if stable_count >= 2 {
                    break; // stable for two consecutive polls
                }
            } else {
                stable_count = 0;
            }
            prev_len = len;
        }
        if std::time::Instant::now() > deadline {
            return Err("PDF export timed out waiting for file to stabilise".to_string());
        }
        std::thread::sleep(Duration::from_millis(50));
    }

    Ok(())
}

/// Find the Microsoft Edge executable on the system.
fn locate_edge() -> Result<String, String> {
    // Common install paths (ordered by likelihood)
    let candidates = [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    ];

    for path in &candidates {
        if std::path::Path::new(path).exists() {
            return Ok(path.to_string());
        }
    }

    // Fallback: try searching PATH via where.exe
    if let Ok(out) = Command::new("where.exe").arg("msedge").output() {
        if out.status.success() {
            let path = String::from_utf8_lossy(&out.stdout)
                .lines()
                .next()
                .unwrap_or("")
                .trim()
                .to_string();
            if !path.is_empty() && std::path::Path::new(&path).exists() {
                return Ok(path);
            }
        }
    }

    Err(
        "Microsoft Edge not found. Please install Microsoft Edge to use PDF export."
            .to_string(),
    )
}
