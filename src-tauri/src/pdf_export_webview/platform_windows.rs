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

    // Edge exits before the file is fully flushed — brief settle
    std::thread::sleep(Duration::from_millis(200));

    // Verify the output file exists and has content
    let meta = std::fs::metadata(output_path)
        .map_err(|e| format!("PDF output file not found: {e}"))?;
    if meta.len() < 10 {
        return Err(format!(
            "PDF file too small ({} bytes), Edge may have failed silently",
            meta.len()
        ));
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
