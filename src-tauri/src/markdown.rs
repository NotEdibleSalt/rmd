use comrak::{markdown_to_html_with_plugins, ComrakOptions, Plugins};
use comrak::plugins::syntect::SyntectAdapter;
use serde::{Deserialize, Serialize};
use regex::Regex;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TocItem {
    pub level: u8,
    pub text: String,
    pub id: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DocumentStats {
    pub word_count: usize,
    pub char_count: usize,
    pub line_count: usize,
    pub heading_count: usize,
    pub code_block_count: usize,
    pub image_count: usize,
    pub table_count: usize,
    pub list_count: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MarkdownOutput {
    pub html: String,
    pub toc: Vec<TocItem>,
    pub stats: DocumentStats,
}

fn slugify(text: &str) -> String {
    text.to_lowercase()
        .chars()
        .map(|c| match c {
            'a'..='z' | '0'..='9' | '-' | '_' => c,
            ' ' | '\t' => '-',
            c if c.is_ascii_alphanumeric() => c,
            _ => '-',
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

pub fn parse(source: &str) -> MarkdownOutput {
    let mut options = ComrakOptions::default();
    options.extension.autolink = true;
    options.extension.table = true;
    options.extension.strikethrough = true;
    options.extension.wikilinks_title_after_pipe = true;
    options.extension.wikilinks_title_before_pipe = false;
    options.extension.tagfilter = true;
    options.extension.tasklist = true;
    options.extension.superscript = true;
    options.extension.header_ids = Some("heading-".to_string());
    options.extension.footnotes = true;
    options.extension.description_lists = true;
    options.extension.front_matter_delimiter = Some("---".to_string());
    options.parse.smart = true;
    options.render.hardbreaks = false;
    options.render.github_pre_lang = true;
    options.render.full_info_string = true;
    options.render.width = 0;
    options.render.unsafe_ = true;

    let syntect = SyntectAdapter::new(Some("base16-ocean.dark"));
    let mut plugins = Plugins::default();
    plugins.render.codefence_syntax_highlighter = Some(&syntect);

    let html = markdown_to_html_with_plugins(source, &options, &plugins);

    // Extract TOC from headings
    // Comrak 0.34 outputs: <h1><a href="#..." aria-hidden="true" class="anchor" id="heading-slug"></a>Heading Text</h1>
    // The id is on the inner <a> tag, not on the <hN> tag.
    let heading_re =
        Regex::new(r#"<h([1-6])[^>]*><a[^>]*id="([^"]+)"[^>]*></a>(.*?)</h[1-6]>"#).unwrap();
    let tag_re = Regex::new(r"<[^>]+>").unwrap();

    let toc: Vec<TocItem> = heading_re
        .captures_iter(&html)
        .map(|cap| {
            let level: u8 = cap[1].parse().unwrap_or(1);
            let id = cap[2].to_string();
            let text_raw = &cap[3];
            let text = tag_re.replace_all(text_raw, " ").to_string();
            let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
            TocItem { level, text, id }
        })
        .collect();

    // Document stats
    let stats = compute_stats(source, &html);

    // Inject heading IDs for any that lack them
    let html = inject_heading_ids(&html);

    MarkdownOutput { html, toc, stats }
}

fn inject_heading_ids(html: &str) -> String {
    // Process each heading level separately since regex doesn't support backreferences
    let mut result = html.to_string();
    let inner_re = Regex::new(r"<[^>]+>").unwrap();
    for level in 1..=6 {
        let pattern = format!(r#"(?i)<h{level}([^>]*)>(.*?)</h{level}>"#);
        let re = Regex::new(&pattern).unwrap();
        result = re
            .replace_all(&result, |caps: &regex::Captures| {
                let attrs = &caps[1];
                let content = &caps[2];
                // Check if id already exists in the heading (comrak puts it on inner <a> tag)
                if caps[0].contains("id=\"") {
                    caps[0].to_string()
                } else {
                    let text = inner_re.replace_all(content, "").to_string();
                    let id = slugify(&text);
                    format!("<h{level} id=\"{id}\"{attrs}>{content}</h{level}>")
                }
            })
            .to_string();
    }
    result
}

fn compute_stats(source: &str, _html: &str) -> DocumentStats {
    let word_count = source
        .split_whitespace()
        .filter(|w| w.chars().any(|c| c.is_alphanumeric()))
        .count();
    let char_count = source.chars().count();
    let line_count = source.lines().count();

    let heading_re = Regex::new(r"^#{1,6}\s+").unwrap();
    let heading_count = source.lines().filter(|l| heading_re.is_match(l)).count();

    let code_re = Regex::new(r"^```").unwrap();
    let code_block_count = source.lines().filter(|l| code_re.is_match(l)).count() / 2;

    let image_re = Regex::new(r"!\[.*?\]\(.*?\)").unwrap();
    let image_count = image_re.find_iter(source).count();

    let table_count = source.lines().filter(|l| l.contains('|') && l.contains("---")).count();
    let list_count = source.lines().filter(|l| {
        let t = l.trim();
        t.starts_with("- ") || t.starts_with("* ") || t.starts_with("+ ") ||
        (t.starts_with(|c: char| c.is_ascii_digit()) && t.contains(". "))
    }).count();

    DocumentStats {
        word_count,
        char_count,
        line_count,
        heading_count,
        code_block_count,
        image_count,
        table_count,
        list_count,
    }
}

// extract_plain_text removed — was only used by the removed TXT export

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn comrak_wikilink_output_shape() {
        let md = "See [[Page Name]] and [[Other|Display]].";
        let html = parse(md).html;
        eprintln!("\n========= comrak wikilink HTML output =========\n{}\n================================================", html);
        assert!(
            html.contains("data-wikilink"),
            "expected `data-wikilink` attribute in HTML, got: {}",
            html
        );
        assert!(
            html.contains("Page%20Name") || html.contains("Page Name") || html.contains("Page_Name"),
            "expected space-encoding or literal space in href for `Page Name`, got: {}",
            html
        );
        assert!(html.contains("Other"), "expected `Other` in href, got: {}", html);
        assert!(html.contains("Display"), "expected `Display` text content, got: {}", html);
    }
}

