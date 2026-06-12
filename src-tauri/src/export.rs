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
    let trimmed = raw.trim().trim_start_matches(|c| c == '.' || c == '/' || c == '\\');
    if let Some(stripped) = trimmed
        .strip_suffix(".md")
        .or_else(|| trimmed.strip_suffix(".markdown"))
    {
        stripped.to_string()
    } else {
        trimmed.to_string()
    }
}

/// Convert inline `[[Page]]` / `[[Page|Display]]` to the display text for the
/// PDF text layer. HTML/DOCX exports go through comrak's wikilink extension and
/// do not need this. Code blocks are excluded upstream by the caller — only
/// plain paragraph / heading / list text should ever reach this function.
fn process_wikilinks(text: &str) -> String {
    // Same regex as src/extensions/WikiLinkMark.ts for cross-pipeline
    // consistency.  However, Rust's `regex` crate does NOT support
    // lookahead, so the (?!\[) gate used in the TS version is replaced
    // by a post-match check here: matches whose full text starts with
    // [[[ indicate a bracket chain from prior malformed insertion and
    // are returned unchanged (effectively "skipped").
    //
    // The base regex deliberately allows [`] as a valid target char so
    // that a match at [[[Page]] (first [[ + target [Page) IS found —
    // then the start-of-match check below rejects it.
    let re = Regex::new(r"\[\[([^\]|]+)(?:\|([^\]]*))?\]\]").unwrap();
    re.replace_all(text, |caps: &regex::Captures| {
        let full = caps.get(0).map(|m| m.as_str()).unwrap_or("");
        // Reject bracket chains: if the matched text starts with [[[,
        // return it as-is instead of extracting a corrupted target.
        if full.starts_with("[[[") {
            return full.to_string();
        }
        let target = normalize_wikilink_target(&caps[1]);
        caps.get(2)
            .map(|m| m.as_str().to_string())
            .unwrap_or(target)
    })
    .to_string()
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
        img { max-width: 100%; }
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

// =============================================================================
// Structured Markdown → PDF renderer
// =============================================================================

/// A parsed block of markdown content.
#[derive(Debug)]
enum MdBlock {
    Heading { level: u8, text: String },
    Paragraph(String),
    UnorderedList { items: Vec<String> },
    OrderedList { start: u64, items: Vec<String> },
    CodeBlock { code: String },
    Table(MdTable),
    Image { alt: String, path: String },
    Blockquote(String),
    HorizontalRule,
}

#[derive(Debug)]
struct MdTable {
    headers: Vec<String>,
    rows: Vec<Vec<String>>,
}

/// Parse markdown source into a sequence of structured blocks.
fn parse_md_blocks(source: &str) -> Vec<MdBlock> {
    let lines: Vec<&str> = source.lines().collect();
    let len = lines.len();
    let mut i = 0;
    let mut blocks = Vec::new();

    while i < len {
        let trimmed = lines[i].trim();

        // Skip empty lines
        if trimmed.is_empty() {
            i += 1;
            continue;
        }

        // Heading: ## text
        if let Some(level) = parse_heading(trimmed) {
            let text = trimmed[level as usize..].trim().to_string();
            if !text.is_empty() {
                blocks.push(MdBlock::Heading { level, text });
            }
            i += 1;
            continue;
        }

        // Fenced code block: ``` ...  ```
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            let mut code_lines: Vec<&str> = Vec::new();
            i += 1;
            while i < len {
                if lines[i].trim() == "```" || lines[i].trim() == "~~~" {
                    i += 1;
                    break;
                }
                code_lines.push(lines[i]);
                i += 1;
            }
            blocks.push(MdBlock::CodeBlock {
                code: code_lines.join("\n"),
            });
            continue;
        }

        // Horizontal rule
        if is_horizontal_rule(trimmed) {
            blocks.push(MdBlock::HorizontalRule);
            i += 1;
            continue;
        }

        // Standalone image:  ![alt](path)
        if let Some((alt, path)) = parse_image_syntax(trimmed) {
            blocks.push(MdBlock::Image { alt, path });
            i += 1;
            continue;
        }

        // Unordered list
        if trimmed.starts_with("- ") || trimmed.starts_with("* ") || trimmed.starts_with("+ ") {
            let mut items = Vec::new();
            while i < len {
                let t = lines[i].trim();
                if let Some(content) = t
                    .strip_prefix("- ")
                    .or_else(|| t.strip_prefix("* "))
                    .or_else(|| t.strip_prefix("+ "))
                {
                    items.push(content.to_string());
                    i += 1;
                } else if t == "-" || t == "*" || t == "+" {
                    items.push(String::new());
                    i += 1;
                } else {
                    break;
                }
            }
            if !items.is_empty() {
                blocks.push(MdBlock::UnorderedList { items });
            }
            continue;
        }

        // Ordered list: 1. item
        if let Some((start, rest)) = parse_ordered_item(trimmed) {
            let mut items = vec![rest.to_string()];
            let mut next = start + 1;
            i += 1;
            while i < len {
                let t = lines[i].trim();
                if let Some((num, content)) = parse_ordered_item(t) {
                    if num == next {
                        items.push(content.to_string());
                        next += 1;
                        i += 1;
                    } else {
                        break;
                    }
                } else {
                    break;
                }
            }
            blocks.push(MdBlock::OrderedList { start, items });
            continue;
        }

        // Blockquote
        if trimmed.starts_with('>') {
            let mut quote_lines = Vec::new();
            while i < len {
                let t = lines[i].trim();
                if let Some(content) = t.strip_prefix('>').map(|s| s.trim()) {
                    quote_lines.push(content);
                    i += 1;
                } else if t.is_empty() {
                    break;
                } else {
                    break;
                }
            }
            blocks.push(MdBlock::Blockquote(quote_lines.join(" ")));
            continue;
        }

        // Table
        if trimmed.starts_with('|') && trimmed.ends_with('|') {
            let mut table_lines: Vec<&str> = Vec::new();
            while i < len {
                let t = lines[i].trim();
                if t.starts_with('|') && t.ends_with('|') {
                    table_lines.push(t);
                    i += 1;
                } else {
                    break;
                }
            }
            if let Some(table) = parse_table(&table_lines) {
                blocks.push(MdBlock::Table(table));
            } else {
                blocks.push(MdBlock::Paragraph(lines[i - table_lines.len()].to_string()));
            }
            continue;
        }

        // Default: paragraph – collect consecutive text lines
        let mut para: Vec<&str> = Vec::new();
        while i < len {
            let t = lines[i].trim();
            if t.is_empty()
                || t.starts_with('#')
                || t.starts_with("```")
                || t.starts_with("~~~")
                || is_horizontal_rule(t)
                || t.starts_with('>')
                || t.starts_with("- ")
                || t.starts_with("* ")
                || t.starts_with("+ ")
                || (t.starts_with('|') && t.ends_with('|'))
            {
                break;
            }
            // Check if it's an ordered list item
            if parse_ordered_item(t).is_some() {
                break;
            }
            para.push(lines[i]);
            i += 1;
        }
        let text = para.join(" ").split_whitespace().collect::<Vec<_>>().join(" ");
        if !text.is_empty() {
            // Replace `[[Page]]` / `[[Page|Display]]` with the display text so the
            // PDF text layer shows "Page" (or "Display") rather than the raw
            // syntax. Code blocks are emitted as their own MdBlock::CodeBlock and
            // never reach this branch.
            blocks.push(MdBlock::Paragraph(process_wikilinks(&text)));
        }
    }

    blocks
}

fn parse_heading(s: &str) -> Option<u8> {
    let trimmed = s.trim_start();
    let mut count = 0u8;
    for ch in trimmed.chars() {
        if ch == '#' {
            count += 1;
        } else {
            break;
        }
    }
    if count >= 1 && count <= 6 && trimmed.len() > count as usize && trimmed.as_bytes()[count as usize] == b' ' {
        Some(count)
    } else {
        None
    }
}

fn parse_ordered_item(s: &str) -> Option<(u64, &str)> {
    let trimmed = s.trim_start();
    let num_end = trimmed
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .count();
    if num_end == 0 {
        return None;
    }
    let num: u64 = trimmed[..num_end].parse().ok()?;
    let rest = trimmed[num_end..].trim_start();
    if rest.starts_with(". ") {
        Some((num, rest[2..].trim()))
    } else if rest == "." {
        Some((num, ""))
    } else {
        None
    }
}

fn is_horizontal_rule(s: &str) -> bool {
    let stripped = s.trim();
    // Must be 3+ of the same character: -, _, *
    if stripped.len() < 3 {
        return false;
    }
    let first = stripped.chars().next().unwrap();
    if first != '-' && first != '_' && first != '*' {
        return false;
    }
    stripped.chars().all(|c| c == first)
}

fn parse_image_syntax(s: &str) -> Option<(String, String)> {
    // Match  ![alt](path)
    let s = s.trim();
    if !s.starts_with("![") {
        return None;
    }
    let close_bracket = s.find("](")?;
    let alt = s[2..close_bracket].to_string();
    let rest = &s[close_bracket + 2..];
    let close_paren = rest.find(')')?;
    let path = rest[..close_paren].to_string();
    Some((alt, path))
}

fn parse_table(lines: &[&str]) -> Option<MdTable> {
    if lines.len() < 2 {
        return None;
    }
    // Parse header row
    let header_row = lines[0]
        .trim()
        .strip_prefix('|')?
        .strip_suffix('|')?;
    let headers: Vec<String> = header_row
        .split('|')
        .map(|s| s.trim().to_string())
        .collect();
    if headers.is_empty() {
        return None;
    }

    // Alignment row (second row) – skip for now; just check it looks like a separator
    // Parse data rows
    let mut rows = Vec::new();
    for line in &lines[2..] {
        let content = line.trim().strip_prefix('|')?.strip_suffix('|')?;
        let cells: Vec<String> = content
            .split('|')
            .map(|s| s.trim().to_string())
            .collect();
        if cells.len() == headers.len() {
            rows.push(cells);
        }
    }

    Some(MdTable { headers, rows })
}

/// Resolve an image path (possibly relative) to an absolute filesystem path.
/// Resolve an image path (possibly relative or Tauri asset URL) to an absolute
/// filesystem path. Returns `None` if the path cannot be resolved.
fn resolve_image_path(raw_path: &str, base_path: &str) -> Option<std::path::PathBuf> {
    use std::path::Path;

    let clean = raw_path.split(&['?', '#'][..]).next().unwrap_or(raw_path);

    // Handle Tauri asset protocol: http://asset.localhost/<URL-encoded path>
    if clean.starts_with("http://asset.localhost/") {
        let encoded = &clean["http://asset.localhost/".len()..];
        // URL-decode the path component
        let decoded = urlencoding::decode(encoded).ok()?;
        let path = std::path::PathBuf::from(decoded.as_ref());
        if path.exists() {
            return Some(path);
        }
        return None;
    }

    // Skip remote URLs and data URIs
    if clean.starts_with("data:") || clean.starts_with("https://") {
        return None;
    }

    if Path::new(clean).is_absolute() {
        Some(std::path::PathBuf::from(clean))
    } else if base_path.is_empty() {
        None
    } else {
        Some(Path::new(base_path).join(clean))
    }
}

fn strip_inline_formatting(text: &str) -> String {
    // Remove bold/italic markers, inline code backticks, and link syntax
    let mut result = String::with_capacity(text.len());
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        match chars[i] {
            '\\' if i + 1 < chars.len() => {
                result.push(chars[i + 1]);
                i += 2;
            }
            '`' => {
                // Skip inline code: `code`
                i += 1;
                while i < chars.len() && chars[i] != '`' {
                    i += 1;
                }
                i += 1;
            }
            '[' => {
                // Link syntax: [text](url) – keep the text, skip url part
                let mut depth = 1;
                let mut link_text = String::new();
                i += 1;
                while i < chars.len() && depth > 0 {
                    if chars[i] == '[' {
                        depth += 1;
                    } else if chars[i] == ']' {
                        depth -= 1;
                        if depth == 0 {
                            // Skip the (url) part
                            if i + 1 < chars.len() && chars[i + 1] == '(' {
                                i += 2;
                                while i < chars.len() && chars[i] != ')' {
                                    i += 1;
                                }
                                if i < chars.len() {
                                    i += 1;
                                }
                            } else {
                                result.push(']');
                            }
                        } else {
                            link_text.push(chars[i]);
                        }
                    } else {
                        link_text.push(chars[i]);
                    }
                    if depth > 0 {
                        i += 1;
                    }
                }
                result.push_str(&link_text);
            }
            '!' if i + 1 < chars.len() && chars[i + 1] == '[' => {
                // Image syntax  ![alt](path) – skip entirely
                i += 2;
                let mut depth = 1;
                while i < chars.len() && depth > 0 {
                    if chars[i] == '[' {
                        depth += 1;
                    } else if chars[i] == ']' {
                        depth -= 1;
                    }
                    i += 1;
                }
                // Skip (path)
                if i < chars.len() && chars[i] == '(' {
                    i += 1;
                    while i < chars.len() && chars[i] != ')' {
                        i += 1;
                    }
                    if i < chars.len() {
                        i += 1;
                    }
                }
            }
            '*' | '_' => {
                // Skip bold/italic markers but keep the text between them
                i += 1;
            }
            '~' => {
                // Skip strikethrough markers
                i += 1;
            }
            _ => {
                result.push(chars[i]);
                i += 1;
            }
        }
    }
    result
}

/// Color palette for PDF rendering, derived from the markdown theme CSS.
struct PdfColors {
    code_bg: (u8, u8, u8),
    border: (u8, u8, u8),
}

impl PdfColors {
    fn new(is_dark: bool) -> Self {
        if is_dark {
            Self {
                code_bg: (46, 46, 69),   // ~#2e2e45
                border: (69, 69, 102),   // ~#454566
            }
        } else {
            Self {
                code_bg: (235, 235, 235), // #ebebeb
                border: (128, 128, 128),  // #808080
            }
        }
    }
}

/// Determine if the markdown theme CSS has a dark background.
fn css_has_dark_bg(css: &str) -> bool {
    // Check .ProseMirror background or body background color
    let re = Regex::new(r"(?i)(?:\.ProseMirror|body)\s*\{[^}]*background\s*:\s*(#[0-9a-fA-F]{6})").unwrap();
    if let Some(cap) = re.captures(css) {
        let hex = &cap[1];
        if let (Ok(r), Ok(g), Ok(b)) = (
            u8::from_str_radix(&hex[1..3], 16),
            u8::from_str_radix(&hex[3..5], 16),
            u8::from_str_radix(&hex[5..7], 16),
        ) {
            // Relative luminance (sRGB) — 128 is a reasonable midpoint
            let lum = 0.299 * r as f32 + 0.587 * g as f32 + 0.114 * b as f32;
            return lum < 128.0;
        }
    }
    // Fallback: look for known dark background indicators
    let dark_indicators = ["#1a1a2e", "#1e1e2e", "#0d1117", "#1a1b26", "--mid-1: #0f0"];
    dark_indicators.iter().any(|s| css.contains(s))
}

pub fn export_to_pdf(source: &str, output_path: &str, base_path: &str, theme: &str, markdown_theme_css: &str) -> Result<(), String> {
    use printpdf::*;
    use std::fs;
    use std::path::Path;

    // Determine dark/light from the markdown theme CSS (if available),
    // falling back to the app chrome theme.
    let is_dark = if markdown_theme_css.is_empty() {
        theme.contains("dark")
    } else {
        css_has_dark_bg(markdown_theme_css)
    };
    let pdf_colors = PdfColors::new(is_dark);

    // Parse markdown into blocks
    let blocks = parse_md_blocks(source);
    if blocks.is_empty() {
        return Err("No content to export".to_string());
    }

    // Create PDF document (A4 portrait)
    let (doc, page1, layer1) = PdfDocument::new("RMD Document", Mm(210.0), Mm(297.0), "Layer 1");
    let layer = doc.get_page(page1).get_layer(layer1);

    // Load fonts
    let font_regular = match load_cjk_font(&doc) {
        Ok(f) => f,
        Err(_) => doc
            .add_builtin_font(BuiltinFont::Helvetica)
            .map_err(|e| format!("Font error: {}", e))?,
    };

    // Constants
    const PAGE_W: f64 = 210.0;
    const PAGE_H: f64 = 297.0;
    const MARGIN: f64 = 25.0;
    const BODY_SIZE: f64 = 11.0;
    const LINE_SPACING: f64 = 6.5; // mm between baselines
    const PARA_GAP: f64 = 4.0; // extra space after paragraph
    const USABLE_W: f64 = PAGE_W - 2.0 * MARGIN; // 160 mm

    // Helper: wrap text to fit USABLE_W at a given font size
    let wrap = |text: &str, font_size: f64| -> Vec<String> {
        let em_mm = font_size * 0.3528;
        let avg_cw = em_mm * 0.7; // conservative avg char width
        let max_chars = (USABLE_W / avg_cw).max(1.0) as usize;
        simple_wrap(text, max_chars)
    };

    // Helper: render a single line of text at current y position
    let render_text =
        |layer: &PdfLayerReference, text: &str, size: f64, x_mm: f64, y_mm: f64, font: &IndirectFontRef| {
            if text.trim().is_empty() {
                return;
            }
            layer.use_text(text, size as f32, Mm(x_mm as f32), Mm(y_mm as f32), font);
        };

    // Helper: render a text line and advance y
    let render_line = |layer: &PdfLayerReference,
                       state: &mut RenderState,
                       text: &str,
                       size: f64,
                       indent: f64,
                       font: &IndirectFontRef| {
        let lines = wrap(text, size);
        for line in &lines {
            if state.y < MARGIN {
                return;
            }
            let x = MARGIN + indent;
            let y = state.y - size * 0.3528;
            render_text(layer, line, size, x, y, font);
            state.y -= LINE_SPACING;
        }
        if lines.len() <= 1 {
            state.y -= 2.0;
        }
    };

    let mut state = RenderState::new(PAGE_H, MARGIN, BODY_SIZE);

    // Draw background rectangle for code (filled polygon)
    let draw_code_bg = |layer: &PdfLayerReference, x: f64, y: f64, w: f64, h: f64| {
        use printpdf::path::{PaintMode, WindingOrder};
        let pts = vec![
            (Point::new(Mm(x as f32), Mm(y as f32)), false),
            (Point::new(Mm((x + w) as f32), Mm(y as f32)), false),
            (Point::new(Mm((x + w) as f32), Mm((y - h) as f32)), false),
            (Point::new(Mm(x as f32), Mm((y - h) as f32)), false),
            (Point::new(Mm(x as f32), Mm(y as f32)), true),
        ];
        let poly = Polygon {
            rings: vec![pts],
            mode: PaintMode::Fill,
            winding_order: WindingOrder::NonZero,
        };
        let (cr, cg, cb) = pdf_colors.code_bg;
        layer.set_fill_color(Color::Rgb(Rgb::new(cr as f32 / 255.0, cg as f32 / 255.0, cb as f32 / 255.0, None)));
        layer.add_polygon(poly);
    };

    // Draw a thin filled rectangle (used for lines / borders)
    let draw_thick_line = |layer: &PdfLayerReference, x: f64, y: f64, length: f64, thickness: f64, vertical: bool| {
        use printpdf::path::{PaintMode, WindingOrder};
        let pts = if vertical {
            vec![
                (Point::new(Mm(x as f32), Mm(y as f32)), false),
                (Point::new(Mm((x + thickness) as f32), Mm(y as f32)), false),
                (Point::new(Mm((x + thickness) as f32), Mm((y - length) as f32)), false),
                (Point::new(Mm(x as f32), Mm((y - length) as f32)), false),
                (Point::new(Mm(x as f32), Mm(y as f32)), true),
            ]
        } else {
            // horizontal
            vec![
                (Point::new(Mm(x as f32), Mm(y as f32)), false),
                (Point::new(Mm((x + length) as f32), Mm(y as f32)), false),
                (Point::new(Mm((x + length) as f32), Mm((y - thickness) as f32)), false),
                (Point::new(Mm(x as f32), Mm((y - thickness) as f32)), false),
                (Point::new(Mm(x as f32), Mm(y as f32)), true),
            ]
        };
        let poly = Polygon {
            rings: vec![pts],
            mode: PaintMode::Fill,
            winding_order: WindingOrder::NonZero,
        };
        let (br, bg, bb) = pdf_colors.border;
        layer.set_fill_color(Color::Rgb(Rgb::new(br as f32 / 255.0, bg as f32 / 255.0, bb as f32 / 255.0, None)));
        layer.add_polygon(poly);
    };

    // Shortcut: draw horizontal rule (thin line across page)
    let draw_horiz = |layer: &PdfLayerReference, x: f64, y: f64, w: f64| {
        draw_thick_line(layer, x, y, w, 0.5, false);
    };

    // Render all blocks
    for block in &blocks {
        if state.y < MARGIN {
            break;
        }

        match block {
            MdBlock::Heading { level, text } => {
                let size = match level {
                    1 => 22.0,
                    2 => 18.0,
                    3 => 15.0,
                    4 => 13.0,
                    5 => 11.0,
                    _ => 10.0,
                };
                let spacing = if *level <= 2 { 8.0 } else { 5.0 };
                let lines = wrap(text, size);
                for line in &lines {
                    if state.y < MARGIN {
                        break;
                    }
                    let y = state.y - size * 0.3528;
                    render_text(&layer, line, size, MARGIN, y, &font_regular);
                    state.y -= LINE_SPACING;
                }
                state.y -= spacing;
            }

            MdBlock::Paragraph(text) => {
                let stripped = strip_inline_formatting(text);
                render_line(&layer, &mut state, &stripped, BODY_SIZE, 0.0, &font_regular);
                state.y -= PARA_GAP;
            }

            MdBlock::UnorderedList { items } => {
                let bullet = "\u{2022} "; // bullet character
                for item in items {
                    if state.y < MARGIN {
                        break;
                    }
                    let stripped = strip_inline_formatting(item);
                    let line_text = format!("{}{}", bullet, stripped);
                    render_line(&layer, &mut state, &line_text, BODY_SIZE, 5.0, &font_regular);
                }
                state.y -= PARA_GAP;
            }

            MdBlock::OrderedList { start, items } => {
                let mut num = *start;
                for item in items {
                    if state.y < MARGIN {
                        break;
                    }
                    let stripped = strip_inline_formatting(item);
                    let prefix = format!("{}. ", num);
                    let line_text = format!("{}{}", prefix, stripped);
                    render_line(&layer, &mut state, &line_text, BODY_SIZE, 5.0, &font_regular);
                    num += 1;
                }
                state.y -= PARA_GAP;
            }

            MdBlock::CodeBlock { code } => {
                let code_size = 9.0;
                let code_lines = wrap(code, code_size);
                let padding = 6.0; // padding inside the background rect
                let indent = 3.0;

                let block_h = code_lines.len() as f64 * (code_size * 0.3528 + 2.0) + padding * 2.0;
                if state.y - block_h < MARGIN {
                    break;
                }

                // Draw background rectangle
                let bg_y = state.y + 3.0; // start a bit above
                draw_code_bg(&layer, MARGIN, bg_y, USABLE_W, block_h + 6.0);

                // Render code text
                let code_indent = MARGIN + indent + padding;
                for line in &code_lines {
                    if state.y < MARGIN {
                        break;
                    }
                    let y = state.y - code_size * 0.3528 - padding;
                    render_text(&layer, line, code_size, code_indent, y, &font_regular);
                    state.y -= code_size * 0.3528 + 2.0;
                }

                state.y -= padding + 10.0; // space after code block
            }

            MdBlock::Table(table) => {
                let font_size = 9.0;
                let cell_pad = 3.0;
                let col_count = table.headers.len();

                // Calculate column widths (equal distribution)
                let col_w = (USABLE_W - cell_pad * (col_count as f64 - 1.0)) / col_count as f64;

                // Estimate table height
                let row_count = 1 + table.rows.len(); // header + data rows
                let row_h = font_size * 0.3528 + 6.0; // cell height
                let table_h = row_count as f64 * row_h + 2.0; // + border
                if state.y - table_h < MARGIN {
                    break;
                }

                let top_y = state.y + 2.0;

                // Render header row
                let header_y = top_y - 4.0;
                for (ci, header) in table.headers.iter().enumerate() {
                    let x = MARGIN + ci as f64 * (col_w + cell_pad) + cell_pad;
                    let y = header_y;
                    render_text(&layer, header, font_size, x, y, &font_regular);
                }

                state.y = top_y - row_h;

                // Render data rows
                for row in &table.rows {
                    if state.y < MARGIN {
                        break;
                    }
                    let row_top = state.y + 2.0;
                    for (ci, cell) in row.iter().enumerate() {
                        if ci >= col_count {
                            break;
                        }
                        let x = MARGIN + ci as f64 * (col_w + cell_pad) + cell_pad;
                        let y = row_top - 4.0;
                        render_text(&layer, cell, font_size, x, y, &font_regular);
                    }
                    state.y -= row_h;
                }

                // Draw grid lines using thin rectangles
                let table_top = top_y;
                let table_bottom = state.y - 4.0;
                let table_left = MARGIN;
                let table_right = MARGIN + USABLE_W;
                let line_th = 0.3;

                // Horizontal lines (top of each row)
                for ri in 0..=row_count {
                    let y = table_top - ri as f64 * row_h;
                    draw_thick_line(&layer, table_left, y, table_right - table_left, line_th, false);
                }

                // Vertical lines (left of each column)
                for ci in 0..=col_count {
                    let x = MARGIN + ci as f64 * (col_w + cell_pad);
                    draw_thick_line(&layer, x, table_top, table_top - table_bottom, line_th, true);
                }

                state.y -= 8.0; // space after table
            }

            MdBlock::Image { alt, path } => {
                let full = resolve_image_path(path, base_path);
                let full = match full {
                    Some(p) => p,
                    None => {
                        // Placeholder text
                        let placeholder = format!("[Image: {}]", alt);
                        render_line(&layer, &mut state, &placeholder, BODY_SIZE, 0.0, &font_regular);
                        state.y -= PARA_GAP;
                        continue;
                    }
                };

                match embed_pdf_image(&doc, &layer, &full, &mut state, MARGIN, USABLE_W) {
                    Ok(_) => {}
                    Err(e) => {
                        eprintln!("[PDF] Failed to embed image {}: {}", path, e);
                        let placeholder = format!("[Image: {}]", alt);
                        render_line(&layer, &mut state, &placeholder, BODY_SIZE, 0.0, &font_regular);
                        state.y -= PARA_GAP;
                    }
                }
            }

            MdBlock::Blockquote(text) => {
                let stripped = strip_inline_formatting(text);
                // Indent by 8mm and add a left bar (just indent for simplicity)
                let indent = 8.0;
                let lines = wrap(&stripped, BODY_SIZE);
                for line in &lines {
                    if state.y < MARGIN {
                        break;
                    }
                    let y = state.y - BODY_SIZE * 0.3528;
                    render_text(&layer, line, BODY_SIZE, MARGIN + indent, y, &font_regular);
                    state.y -= LINE_SPACING;
                }
                state.y -= PARA_GAP;
            }

            MdBlock::HorizontalRule => {
                let y = state.y;
                draw_horiz(&layer, MARGIN, y, USABLE_W);
                state.y -= 8.0;
            }
        }
    }

    // Save PDF
    let file = fs::File::create(Path::new(output_path)).map_err(|e| e.to_string())?;
    doc.save(&mut std::io::BufWriter::new(file))
        .map_err(|e| e.to_string())?;

    Ok(())
}

// ---------------------------------------------------------------------------
// State tracker for PDF rendering
// ---------------------------------------------------------------------------
struct RenderState {
    y: f64,
}

impl RenderState {
    fn new(page_h: f64, margin: f64, _font_size: f64) -> Self {
        // Start below the top margin, accounting for first line's ascent
        Self {
            y: page_h - margin,
        }
    }
}

// ---------------------------------------------------------------------------
// Image embedding for PDF (requires printpdf `image` feature)
// ---------------------------------------------------------------------------
fn embed_pdf_image(
    _doc: &printpdf::PdfDocumentReference,
    layer: &printpdf::PdfLayerReference,
    path: &std::path::Path,
    state: &mut RenderState,
    margin: f64,
    usable_w: f64,
) -> Result<(), String> {
    use printpdf::*;
    use image_crate::GenericImageView;

    // Decode image using image_crate (printpdf's re-export of the image crate)
    let img = image_crate::open(path).map_err(|e| format!("Cannot open image: {}", e))?;
    let (w_px, h_px) = img.dimensions();

    if w_px == 0 || h_px == 0 {
        return Err("Zero-sized image".to_string());
    }

    // Natural physical size at 150 DPI (a common print resolution).
    // This means e.g. a 100×100 icon → ~17×17mm, a 4032×3024 photo → 683×512mm
    // (the latter will be scaled down below).
    const NAT_DPI: f64 = 150.0;
    let nat_w_mm = w_px as f64 * 25.4 / NAT_DPI;
    let nat_h_mm = h_px as f64 * 25.4 / NAT_DPI;

    // Start with natural size; only scale DOWN if needed — never upscale.
    let mut scale = 1.0;

    // 1. Fit page width (max 160 mm)
    let max_w = usable_w.min(160.0);
    if nat_w_mm * scale > max_w {
        scale = max_w / nat_w_mm;
    }

    // 2. Cap absolute height at 220 mm (prevents extremely tall images)
    if nat_h_mm * scale > 220.0 {
        scale = (220.0 / nat_h_mm).min(scale);
    }

    // 3. Fit available vertical space on the current page
    let available_h = state.y - 25.0;
    if available_h < 10.0 {
        return Err("Not enough space".to_string());
    }
    if nat_h_mm * scale > available_h {
        scale = (available_h / nat_h_mm).min(scale);
    }

    let disp_w = nat_w_mm * scale;
    let disp_h = nat_h_mm * scale;
    let img_bottom_y = state.y - disp_h;

    // add_to_layer internally computes: pt_width = w_px * 72 / dpi * scale_x
    // We want pt_width to correspond to disp_w mm:
    //   disp_w / 25.4 * 72 = w_px * 72 / dpi * scale_x
    //   ⇒ scale_x = disp_w * dpi / (w_px * 25.4)
    const LAYER_DPI: f32 = 300.0;
    let scale_x = disp_w * LAYER_DPI as f64 / (w_px as f64 * 25.4);
    let scale_y = disp_h * LAYER_DPI as f64 / (h_px as f64 * 25.4);

    let image = Image::from_dynamic_image(&img);
    image.add_to_layer(layer.clone(), ImageTransform {
        translate_x: Some(Mm(margin as f32)),
        translate_y: Some(Mm(img_bottom_y as f32)),
        scale_x: Some(scale_x as f32),
        scale_y: Some(scale_y as f32),
        ..Default::default()
    });

    state.y = img_bottom_y - 8.0;

    Ok(())
}

/// Try to load a system CJK font. Searches known paths on Windows, macOS, and Linux.
fn load_cjk_font(doc: &printpdf::PdfDocumentReference) -> Result<printpdf::IndirectFontRef, String> {
    // Ordered by preference (modern sans-serif first)
    let candidates = [
        // Windows — TTF
        r"C:\Windows\Fonts\Deng.ttf",          // DengXian (等线), modern sans-serif
        r"C:\Windows\Fonts\simhei.ttf",         // SimHei (黑体), classic sans-serif
        r"C:\Windows\Fonts\msyh.ttc",           // Microsoft YaHei (微软雅黑) — TTC
        r"C:\Windows\Fonts\msyhbd.ttc",         // Microsoft YaHei Bold
        r"C:\Windows\Fonts\simsun.ttc",         // SimSun (宋体)
        r"C:\Windows\Fonts\simfang.ttf",        // SimFang (仿宋)
        r"C:\Windows\Fonts\simkai.ttf",         // SimKai (楷体)
        r"C:\Windows\Fonts\NotoSansSC-VF.ttf",  // Noto Sans SC
        r"C:\Windows\Fonts\NotoSerifSC-VF.ttf", // Noto Serif SC
        // macOS
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/STHeiti Light.ttc",
        "/System/Library/Fonts/STHeiti Medium.ttc",
        // Linux
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
    ];

    for path in &candidates {
        if Path::new(path).exists() {
            match std::fs::File::open(path) {
                Ok(file) => {
                    let mut reader = std::io::BufReader::new(file);
                    match doc.add_external_font(&mut reader) {
                        Ok(font) => {
                            eprintln!("[PDF] Loaded CJK font: {path}");
                            return Ok(font);
                        }
                        Err(e) => {
                            eprintln!("[PDF] Font {path} load failed: {e:?}, trying next...");
                        }
                    }
                }
                Err(e) => {
                    eprintln!("[PDF] Could not open {path}: {e}");
                }
            }
        }
    }
    Err("No CJK font found on system".to_string())
}

/// Simple word-wrap that breaks text to fit within `max_chars` per line.
/// Estimates character width: CJK≈1, Latin≈0.5, digits/punct≈0.5.
/// Tries to break at spaces when possible.
fn simple_wrap(text: &str, max_chars: usize) -> Vec<String> {
    if max_chars < 5 || text.is_empty() {
        return vec![text.to_string()];
    }

    let mut lines: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut current_width = 0.0_f64;
    let mut last_space_idx: Option<usize> = None;

    for ch in text.chars() {
        let cw = char_width(ch);

        if current_width + cw > max_chars as f64 && !current.is_empty() {
            // If we have a space to break at, use it
            if let Some(sp_idx) = last_space_idx {
                let break_at = sp_idx;
                // Find a space to split
                if let Some(space_pos) = current[..break_at].rfind(' ') {
                    let (before, _) = current.split_at(space_pos + 1);
                    lines.push(before.trim().to_string());
                    current = current[space_pos + 1..].to_string() + &ch.to_string();
                    current_width = text_width(&current);
                } else {
                    lines.push(current.trim().to_string());
                    current = ch.to_string();
                    current_width = cw;
                }
                last_space_idx = None;
            } else {
                lines.push(current.trim().to_string());
                current = ch.to_string();
                current_width = cw;
            }
        } else {
            if ch == ' ' {
                last_space_idx = Some(current.len());
            }
            current.push(ch);
            current_width += cw;
        }
    }

    if !current.trim().is_empty() {
        lines.push(current.trim().to_string());
    }

    // If wrapping produced nothing useful, return original
    if lines.is_empty() || (lines.len() == 1 && lines[0] == text.trim()) {
        // If still too long, hard-break at max_chars
        let trimmed = text.trim().to_string();
        if text_width(&trimmed) > max_chars as f64 {
            let mut hard_breaks = Vec::new();
            let mut pos = 0;
            let chars: Vec<char> = trimmed.chars().collect();
            while pos < chars.len() {
                let mut width = 0.0;
                let mut end = pos;
                while end < chars.len() && width + char_width(chars[end]) <= max_chars as f64 {
                    width += char_width(chars[end]);
                    end += 1;
                }
                if end == pos {
                    end = pos + 1; // ensure progress
                }
                hard_breaks.push(chars[pos..end].iter().collect::<String>());
                pos = end;
            }
            return hard_breaks;
        }
    }

    lines
}

/// Estimate visible width of a character in "em" units.
#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_png(path: &std::path::Path, w: u32, h: u32) {
        let mut buf = vec![0u8; (w * h * 4) as usize];
        // Draw a red square with a blue border
        for y in 0..h {
            for x in 0..w {
                let idx = ((y * w + x) * 4) as usize;
                let border = 10;
                if x < border || x >= w - border || y < border || y >= h - border {
                    buf[idx] = 0;     // B
                    buf[idx + 1] = 0; // G
                    buf[idx + 2] = 255; // R
                    buf[idx + 3] = 255; // A
                } else {
                    buf[idx] = 0;     // B
                    buf[idx + 1] = 0; // G
                    buf[idx + 2] = 200; // R
                    buf[idx + 3] = 255; // A
                }
            }
        }
        printpdf::image_crate::save_buffer(path, &buf, w, h, printpdf::image_crate::ColorType::Rgba8)
            .expect("Failed to save test PNG");
    }

    #[test]
    fn test_export_pdf_creates_file() {
        let md = r#"# Heading 1

This is a **paragraph** with *formatting* and a [link](https://example.com).

## Code Block

```rust
fn main() {
    println!("Hello, 世界!");
}
```

## Table

| Name | Value |
|------|-------|
| Alpha | 100 |
| Beta | 200 测试 |

- Item one
- Item two 中文

1. First step
2. Second step

> Blockquote text here

---

Image test: ![alt](nonexistent.png)
"#;

        let tmp = std::env::temp_dir().join("test_rmd_export.pdf");
        let path = tmp.to_str().unwrap().to_string();

        let result = export_to_pdf(md, &path, "", "light", "");
        assert!(result.is_ok(), "export_to_pdf failed: {:?}", result.err());
        assert!(std::path::Path::new(&path).exists(), "PDF file was not created");

        let metadata = std::fs::metadata(&path).unwrap();
        assert!(metadata.len() > 1000, "PDF file too small: {} bytes", metadata.len());

        // Cleanup
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_export_pdf_with_real_image() {
        let tmp_dir = std::env::temp_dir().join("rmd_pdf_test");
        let _ = std::fs::create_dir_all(&tmp_dir);

        // Create a test image (400x300 = 4:3, same aspect as a landscape photo)
        let img_path = tmp_dir.join("test_img.png");
        create_test_png(&img_path, 400, 300);

        let md = format!(
            "# PDF Image Test\n\nThis is a test paragraph before the image.\n\n![test image]({})\n\nParagraph after the image.\n",
            img_path.to_str().unwrap()
        );

        let pdf_path = tmp_dir.join("output.pdf");
        let pdf_str = pdf_path.to_str().unwrap().to_string();

        let result = export_to_pdf(&md, &pdf_str, "", "light", "");
        assert!(result.is_ok(), "export_to_pdf failed: {:?}", result.err());
        assert!(pdf_path.exists(), "PDF file was not created");

        let metadata = std::fs::metadata(&pdf_path).unwrap();
        // Should be much larger with an embedded image (>10KB)
        assert!(metadata.len() > 10_000, "PDF file too small: {} bytes", metadata.len());

        eprintln!("[TEST] PDF generated: {} ({} bytes)", pdf_path.display(), metadata.len());

        // Cleanup
        let _ = std::fs::remove_file(&pdf_path);
        let _ = std::fs::remove_file(&img_path);
        let _ = std::fs::remove_dir(&tmp_dir);
    }

    #[test]
    fn test_small_image_not_upscaled() {
        let tmp_dir = std::env::temp_dir().join("rmd_pdf_small_img_test");
        let _ = std::fs::create_dir_all(&tmp_dir);

        // Small 32×32 icon — at 150 DPI natural size ≈ 5.4×5.4 mm
        let img_path = tmp_dir.join("small_icon.png");
        create_test_png(&img_path, 32, 32);

        let md = format!("Small icon: ![i]({})\n", img_path.to_str().unwrap());
        let pdf_path = tmp_dir.join("small_output.pdf");
        let pdf_str = pdf_path.to_str().unwrap().to_string();

        let result = export_to_pdf(&md, &pdf_str, "", "light", "");
        assert!(result.is_ok(), "export_to_pdf failed: {:?}", result.err());

        // Cleanup
        let _ = std::fs::remove_file(&pdf_path);
        let _ = std::fs::remove_file(&img_path);
        let _ = std::fs::remove_dir(&tmp_dir);
    }

    #[test]
    fn process_wikilinks_basic() {
        assert_eq!(
            process_wikilinks("Hello [[Page]] world"),
            "Hello Page world"
        );
    }

    #[test]
    fn process_wikilinks_with_alias() {
        assert_eq!(
            process_wikilinks("See [[Page|Display Text]]"),
            "See Display Text"
        );
    }

    #[test]
    fn process_wikilinks_no_match() {
        assert_eq!(
            process_wikilinks("No links here"),
            "No links here"
        );
    }

    #[test]
    fn process_wikilinks_multiple() {
        assert_eq!(
            process_wikilinks("[[A]] and [[B]] and [[C|ccc]]"),
            "A and B and ccc"
        );
    }
}

fn char_width(c: char) -> f64 {
    match c {
        // CJK Unified Ideographs
        '\u{4E00}'..='\u{9FFF}' => 1.0,
        // CJK Extension A
        '\u{3400}'..='\u{4DBF}' => 1.0,
        // CJK Compatibility Ideographs
        '\u{F900}'..='\u{FAFF}' => 1.0,
        // CJK Symbols and Punctuation
        '\u{3000}'..='\u{303F}' => 1.0,
        // Fullwidth forms
        '\u{FF00}'..='\u{FFEF}' => 1.0,
        // Hiragana / Katakana
        '\u{3040}'..='\u{309F}' | '\u{30A0}'..='\u{30FF}' => 1.0,
        // Hangul
        '\u{AC00}'..='\u{D7AF}' => 1.0,
        // Everything else (Latin, digits, punctuation) ~0.5em
        _ => 0.5,
    }
}

/// Estimate total width of a string in em units.
fn text_width(s: &str) -> f64 {
    s.chars().map(char_width).sum()
}

pub fn export_to_docx(source: &str, output_path: &str, base_path: &str, theme_options: &str) -> Result<(), String> {
    let bytes = crate::docx::generate(source, base_path, theme_options)?;
    std::fs::write(output_path, bytes).map_err(|e| e.to_string())?;
    Ok(())
}
