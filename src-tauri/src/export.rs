use crate::markdown;
use base64::Engine;
use regex::Regex;
use std::fs;
use std::path::{Path, PathBuf};

/// Determine MIME type from file extension
fn mime_from_ext(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        _ => "image/png",
    }
}

/// Try to embed a local file as a base64 data URI. Returns `None` if the file
/// can't be read or the path is a remote / data URL.
fn try_embed_file(raw_path: &str, base_path: &str) -> Option<String> {
    // Strip optional query/hash
    let clean = raw_path.split(&['?', '#'][..]).next().unwrap_or(raw_path);

    // Skip data URIs and remote URLs
    if clean.starts_with("data:") || clean.starts_with("http://") || clean.starts_with("https://") {
        return None;
    }

    // Resolve relative path against base_path
    let full = if Path::new(clean).is_absolute() {
        PathBuf::from(clean)
    } else if base_path.is_empty() {
        return None;
    } else {
        Path::new(base_path).join(clean)
    };

    let bytes = fs::read(&full).ok()?;
    let mime = mime_from_ext(&full);
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Some(format!("data:{};base64,{}", mime, b64))
}

/// Strip ./ prefix and .md/.markdown extension from a wikilink target
/// so [[./bb.md]] resolves to the same file as [[bb]].
pub(crate) fn normalize_wikilink_target(raw: &str) -> String {
    let trimmed = raw.trim().trim_start_matches(['.', '/', '\\']);
    if let Some(stripped) = trimmed
        .strip_suffix(".md")
        .or_else(|| trimmed.strip_suffix(".markdown"))
    {
        stripped.to_string()
    } else {
        trimmed.to_string()
    }
}

/// Embed local images found as markdown `![alt](path)` syntax.
fn embed_markdown_images(source: &str, base_path: &str) -> String {
    let re = Regex::new(r#"!\[([^\]]*)\]\(([^)]+)\)"#).unwrap();
    re.replace_all(source, |caps: &regex::Captures<'_>| {
        let alt = &caps[1];
        let path = &caps[2];
        match try_embed_file(path, base_path) {
            Some(data_uri) => format!("![{}]({})", alt, data_uri),
            None => caps[0].to_string(),
        }
    })
    .to_string()
}

/// Embed local images found as HTML `<img src="...">` tags in rendered HTML.
fn embed_html_images(html: &str, base_path: &str) -> String {
    // Match <img … src="…" …>  or  <img … src='…' …>
    let re = Regex::new(r#"(<img\s[^>]*?src\s*=\s*["'])([^"']+)(["'][^>]*>)"#).unwrap();
    re.replace_all(html, |caps: &regex::Captures<'_>| {
        let prefix = &caps[1];
        let path = &caps[2];
        let suffix = &caps[3];
        match try_embed_file(path, base_path) {
            Some(data_uri) => format!("{}{}{}", prefix, data_uri, suffix),
            None => caps[0].to_string(),
        }
    })
    .to_string()
}

pub fn export_to_html(source: &str, title: &str, theme: &str, base_path: &str, markdown_theme_css: &str) -> Result<String, String> {
    // 1. Embed images in markdown syntax
    let source = embed_markdown_images(source, base_path);
    // 2. Parse to HTML
    let parsed = markdown::parse(&source);
    // 3. Also embed any <img> tags that came through as raw HTML
    let content = embed_html_images(&parsed.html, base_path);

    // Determine if we have markdown theme CSS from the editor
    let use_theme_css = !markdown_theme_css.is_empty();

    // Base page styles (body resets that the theme CSS may not cover)
    let base_style = r#"
        body { margin: 0; padding: 40px 24px; line-height: 1.7; }
        .ProseMirror { max-width: 860px; margin: 0 auto; }
        img { max-width: 100%; height: auto; }
        @media print {
            @page { margin: 0; }
            body { padding: 15mm 20mm; }
            .ProseMirror { max-width: 160mm; padding: 0; }
            img { max-width: 100% !important; height: auto !important; }
            /* Mermaid SVG charts — narrower to match editor visual proportion */
            img[src^="data:image/svg+xml"] {
                display: block !important;
                max-width: 70% !important;
                height: auto !important;
                margin: 0 auto !important;
            }
        }
    "#;

    let css = if use_theme_css {
        format!("{}{}", base_style, markdown_theme_css)
    } else {
        // Fallback: hardcoded minimal styles based on app chrome theme
        let is_dark = theme.contains("dark");
        let fallback = if is_dark {
            r#"
            body { background: #1a1a2e; color: #e0e0e0; font-family: system-ui, -apple-system, sans-serif; }
            .ProseMirror { max-width: 860px; margin: 0 auto; padding: 40px 24px; line-height: 1.7; }
            h1, h2, h3, h4 { color: #e0e0e0; border-bottom: 1px solid #333; }
            code { background: #2d2d44; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
            pre { background: #2d2d44; padding: 16px; border-radius: 8px; overflow-x: auto; }
            pre code { background: none; padding: 0; }
            blockquote { border-left: 4px solid #4a4a6a; margin: 0; padding-left: 16px; color: #999; }
            table { border-collapse: collapse; width: 100%; }
            th, td { border: 1px solid #444; padding: 8px 12px; text-align: left; }
            th { background: #2d2d44; }
            img { max-width: 100%; border-radius: 8px; }
            a { color: #7ec8e3; }
            "#.to_string()
        } else {
            r#"
            body { background: #fff; color: #333; font-family: system-ui, -apple-system, sans-serif; }
            .ProseMirror { max-width: 860px; margin: 0 auto; padding: 40px 24px; line-height: 1.7; }
            h1, h2, h3, h4 { color: #1a1a1a; border-bottom: 1px solid #eee; }
            code { background: #f5f5f5; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
            pre { background: #f8f8f8; padding: 16px; border-radius: 8px; overflow-x: auto; }
            pre code { background: none; padding: 0; }
            blockquote { border-left: 4px solid #ddd; margin: 0; padding-left: 16px; color: #666; }
            table { border-collapse: collapse; width: 100%; }
            th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
            th { background: #f5f5f5; }
            img { max-width: 100%; border-radius: 8px; }
            a { color: #0366d6; }
            "#.to_string()
        };
        format!("{}{}", base_style, fallback)
    };

    let html = format!(
        r#"<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title}</title>
<style>{css}</style>
</head>
<body>
<div class="ProseMirror">
{content}
</div>
</body>
</html>"#,
        title = title,
        css = css,
        content = content
    );

    Ok(html)
}

pub fn export_to_docx(source: &str, output_path: &str, base_path: &str, theme_options: &str) -> Result<(), String> {
    let bytes = crate::docx::generate(source, base_path, theme_options)?;
    std::fs::write(output_path, bytes).map_err(|e| e.to_string())?;
    Ok(())
}
