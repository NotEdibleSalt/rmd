mod images;
mod styles;
mod footnotes;

use comrak::nodes::{AstNode, NodeValue};
use comrak::{parse_document, Arena, ComrakOptions};
use crate::export::normalize_wikilink_target;
use quick_xml::events::{BytesDecl, BytesEnd, BytesStart, BytesText, Event};
use quick_xml::Writer;
use serde::Deserialize;
use std::io::Write;

/// Theme options from the frontend — resolved font/color values extracted from the markdown theme CSS.
#[derive(Debug, Default, Deserialize)]
struct DocxTheme {
    #[serde(default)]
    body_font: String,
    #[serde(default)]
    heading_font: String,
    #[serde(default)]
    code_font: String,
    #[serde(default)]
    body_color: String,
    #[serde(default)]
    code_bg: String,
    #[serde(default)]
    code_color: String,
}

struct RelEntry {
    id: String,
    rel_type: String,
    target: String,
    target_mode: Option<String>,
}

struct DocxWriter {
    document: Writer<Vec<u8>>,
    styles: Writer<Vec<u8>>,
    numbering: Writer<Vec<u8>>,
    footnotes: Option<Writer<Vec<u8>>>,
    rels_entries: Vec<RelEntry>,
    content_types: Writer<Vec<u8>>,
    images: Vec<(String, Vec<u8>)>,
    rel_id_counter: u32,
    footnote_defs: Vec<(u64, Vec<u8>)>, // (id, rendered content bytes)
    heading_counters: [u32; 6],          // heading numbering per level (index 0 = H1, 5 = H6)
    theme: DocxTheme,
}

pub fn generate(source: &str, base_path: &str, theme_options: &str) -> Result<Vec<u8>, String> {
    let theme: DocxTheme = if theme_options.is_empty() {
        DocxTheme::default()
    } else {
        serde_json::from_str(theme_options).unwrap_or_default()
    };
    let mut writer = DocxWriter::new(theme);
    writer.parse_and_write(source, base_path)?;
    writer.finalize_zip()
}

impl DocxWriter {
    fn new(theme: DocxTheme) -> Self {
        Self {
            document: Writer::new_with_indent(Vec::new(), b' ', 2),
            styles: Writer::new_with_indent(Vec::new(), b' ', 2),
            numbering: Writer::new_with_indent(Vec::new(), b' ', 2),
            footnotes: None,
            rels_entries: Vec::new(),
            content_types: Writer::new_with_indent(Vec::new(), b' ', 2),
            images: Vec::new(),
            rel_id_counter: 0,
            footnote_defs: Vec::new(),
            heading_counters: [0; 6],
            theme,
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Helper: font/size writers (standalone functions)
// ═══════════════════════════════════════════════════════════════════════

fn write_rfont(w: &mut Writer<Vec<u8>>, font: &str) {
    let mut rfonts = BytesStart::new("w:rFonts");
    rfonts.push_attribute(("w:ascii", font));
    rfonts.push_attribute(("w:hAnsi", font));
    rfonts.push_attribute(("w:cs", font));
    w.write_event(Event::Empty(rfonts)).unwrap();
}

fn write_sz(w: &mut Writer<Vec<u8>>, sz: u16) {
    let mut elem = BytesStart::new("w:sz");
    elem.push_attribute(("w:val", sz.to_string().as_str()));
    w.write_event(Event::Empty(elem)).unwrap();
    let mut elem2 = BytesStart::new("w:szCs");
    elem2.push_attribute(("w:val", sz.to_string().as_str()));
    w.write_event(Event::Empty(elem2)).unwrap();
}

// ═══════════════════════════════════════════════════════════════════════
// Parse: AST traversal
// ═══════════════════════════════════════════════════════════════════════

impl DocxWriter {
    fn parse_and_write(&mut self, source: &str, base_path: &str) -> Result<(), String> {
        // Parse markdown with comrak FIRST so footnotes are known
        let arena = Arena::new();
        let mut options = ComrakOptions::default();
        options.extension.autolink = true;
        options.extension.table = true;
        options.extension.strikethrough = true;
        options.extension.wikilinks_title_after_pipe = true;
        options.extension.tagfilter = true;
        options.extension.tasklist = true;
        options.extension.superscript = true;
        options.extension.footnotes = true;
        options.extension.description_lists = true;
        options.render.unsafe_ = true;
        let root = parse_document(&arena, source, &options);

        // First pass: collect footnotes (populates self.footnote_defs)
        self.collect_footnotes(root);

        // Now write boilerplate with footnotes already known
        self.write_content_types()?;
        self.collect_rels()?;
        self.write_styles()?;

        // Begin document.xml
        self.document
            .write_event(Event::Decl(BytesDecl::new("1.0", Some("UTF-8"), None)))
            .map_err(|e| e.to_string())?;
        self.document
            .write_event(Event::Start(
                BytesStart::new("w:document")
                    .with_attributes([(
                        "xmlns:w",
                        "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
                    )])
                    .with_attributes([(
                        "xmlns:r",
                        "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
                    )]),
            ))
            .map_err(|e| e.to_string())?;
        self.document
            .write_event(Event::Start(BytesStart::new("w:body")))
            .map_err(|e| e.to_string())?;

        // Second pass: traverse AST and write document content
        self.walk_ast(root, base_path);

        // Close document.xml body
        self.document
            .write_event(Event::End(BytesEnd::new("w:body")))
            .map_err(|e| e.to_string())?;
        self.document
            .write_event(Event::End(BytesEnd::new("w:document")))
            .map_err(|e| e.to_string())?;

        // Write footnotes if any (after boilerplate writers are done)
        if !self.footnote_defs.is_empty() {
            self.write_footnotes_part()?;
        }

        Ok(())
    }

    fn walk_ast<'a>(&mut self, node: &'a AstNode<'a>, base_path: &str) {
        let node_value = &node.data.borrow().value;
        match node_value {
            NodeValue::Heading(heading) => {
                let level = heading.level.clamp(1, 6);
                let idx = (level - 1) as usize;

                // Update heading counters
                self.heading_counters[idx] += 1;
                for c in &mut self.heading_counters[idx + 1..] {
                    *c = 0;
                }

                // Build number prefix (e.g. "1.2.3")
                let mut num_str = String::new();
                for (i, c) in self.heading_counters.iter().enumerate() {
                    if *c == 0 {
                        break;
                    }
                    if !num_str.is_empty() {
                        num_str.push('.');
                    }
                    num_str.push_str(&c.to_string());
                    if i == idx {
                        break;
                    }
                }
                let prefix = format!("{}  ", num_str);

                self.write_paragraph_start(Some(&format!("Heading{}", level)), None);
                // Write number prefix as a regular text run
                self.write_text_run(&prefix);
                for child in node.children() {
                    self.walk_ast(child, base_path);
                }
                self.write_paragraph_end();
            }

            NodeValue::Paragraph => {
                let has_image = node.children().any(|child| {
                    matches!(&child.data.borrow().value, NodeValue::Image(_))
                });
                self.write_paragraph_start(None, if has_image { Some("center") } else { None });
                for child in node.children() {
                    self.walk_ast(child, base_path);
                }
                self.write_paragraph_end();
            }

            NodeValue::Text(text) => {
                self.write_text_run(text);
            }

            NodeValue::Strong => {
                self.write_run_start(true, false, false, false, false);
                for child in node.children() {
                    self.walk_ast(child, base_path);
                }
                self.write_run_end();
            }

            NodeValue::Emph => {
                self.write_run_start(false, true, false, false, false);
                for child in node.children() {
                    self.walk_ast(child, base_path);
                }
                self.write_run_end();
            }

            NodeValue::Code(code) => {
                self.write_code_run(&code.literal);
            }

            NodeValue::CodeBlock(code_block) => {
                let lang = code_block.info.as_str();
                self.write_code_block(lang, &code_block.literal);
            }

            NodeValue::Link(link) => {
                self.write_hyperlink(&link.url, node, base_path);
            }

            NodeValue::Image(image) => {
                self.write_image(&image.url, &image.title, base_path);
            }

            NodeValue::List(list) => {
                let ordered = matches!(list.list_type, comrak::nodes::ListType::Ordered);
                let start = list.start;
                let start_u64 = start as u64;
                for child in node.children() {
                    let (is_task, checked) = match &child.data.borrow().value {
                        NodeValue::TaskItem(m) => (true, m.is_some()),
                        _ => (false, false),
                    };
                    if is_task {
                        self.write_list_item(ordered, start_u64, checked, true);
                    } else if let NodeValue::Item(_) = child.data.borrow().value {
                        self.write_list_item(ordered, start_u64, false, false);
                    } else {
                        continue;
                    }
                    // Write content (comrak strips task markers from text)
                    for grandchild in child.children() {
                        // Flatten Paragraph nodes — list item already opened <w:p>
                        let is_para =
                            matches!(grandchild.data.borrow().value, NodeValue::Paragraph);
                        if is_para {
                            for text_child in grandchild.children() {
                                if let NodeValue::Text(ref t) = text_child.data.borrow().value {
                                    self.write_text_run(t);
                                } else {
                                    self.walk_ast(text_child, base_path);
                                }
                            }
                        } else if let NodeValue::Text(ref t) = grandchild.data.borrow().value {
                            self.write_text_run(t);
                        } else {
                            self.walk_ast(grandchild, base_path);
                        }
                    }
                    self.write_paragraph_end();
                }
            }

            NodeValue::Item(_) => {
                // Handled at the List level above
            }

            NodeValue::BlockQuote => {
                for child in node.children() {
                    match &child.data.borrow().value {
                        // Each paragraph inside a blockquote gets its own <w:p> with Quote style
                        NodeValue::Paragraph => {
                            self.write_paragraph_start(Some("Quote"), None);
                            for text_child in child.children() {
                                self.walk_ast(text_child, base_path);
                            }
                            self.write_paragraph_end();
                        }
                        _ => {
                            self.walk_ast(child, base_path);
                        }
                    }
                }
            }

            NodeValue::Table(_table) => {
                self.write_table(node, base_path);
            }

            NodeValue::Strikethrough => {
                self.write_run_start(false, false, true, false, false);
                for child in node.children() {
                    self.walk_ast(child, base_path);
                }
                self.write_run_end();
            }

            NodeValue::Superscript => {
                self.write_run_start(false, false, false, true, false);
                for child in node.children() {
                    self.walk_ast(child, base_path);
                }
                self.write_run_end();
            }

            NodeValue::ThematicBreak => {
                self.write_thematic_break();
            }

            NodeValue::LineBreak | NodeValue::SoftBreak => {
                self.write_line_break();
            }

            NodeValue::WikiLink(wikilink) => {
                // NodeWikiLink only has `url`; walk children for piped display text, fall back to normalized URL
                let mut display = String::new();
                for child in node.children() {
                    if let NodeValue::Text(t) = &child.data.borrow().value {
                        display.push_str(t);
                    }
                }
                if display.is_empty() {
                    display = normalize_wikilink_target(&wikilink.url);
                }
                self.write_text_run(&display);
            }

            NodeValue::FootnoteReference(ref note) => {
                let id = note.ref_num as u64;
                let mapped_id = self.resolve_footnote_id(id);
                self.write_footnote_reference(mapped_id);
            }

            NodeValue::FootnoteDefinition(_) => {
                // Content is emitted to footnotes.xml in a separate pass
                // During walk_ast, just skip — already collected in collect_footnotes
            }

            NodeValue::FrontMatter(_) => {
                // Skip — YAML metadata not rendered in document body
            }

            NodeValue::DescriptionList => {
                // Render as indented paragraph text
                for child in node.children() {
                    if let NodeValue::DescriptionItem(_) = child.data.borrow().value {
                        for desc_child in child.children() {
                            if let NodeValue::DescriptionTerm = desc_child.data.borrow().value {
                                self.write_run_start(false, false, false, false, true);
                                for t in desc_child.children() {
                                    if let NodeValue::Text(text) = &t.data.borrow().value {
                                        self.write_text_run(text);
                                    }
                                }
                                self.write_run_end();
                            } else if let NodeValue::DescriptionDetails =
                                desc_child.data.borrow().value
                            {
                                for t in desc_child.children() {
                                    self.walk_ast(t, base_path);
                                }
                            }
                        }
                    }
                }
            }

            _ => {
                // Unknown node — skip gracefully
                for child in node.children() {
                    self.walk_ast(child, base_path);
                }
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Element writers: paragraph, run, text, breaks
// ═══════════════════════════════════════════════════════════════════════

impl DocxWriter {
    fn write_paragraph_start(&mut self, style_id: Option<&str>, align: Option<&str>) {
        let w = &mut self.document;
        w.write_event(Event::Start(BytesStart::new("w:p"))).unwrap();
        if style_id.is_some() || align.is_some() {
            w.write_event(Event::Start(BytesStart::new("w:pPr")))
                .unwrap();
            if let Some(sid) = style_id {
                let mut p_style = BytesStart::new("w:pStyle");
                p_style.push_attribute(("w:val", sid));
                w.write_event(Event::Empty(p_style)).unwrap();
            }
            if let Some(alignment) = align {
                let mut jc = BytesStart::new("w:jc");
                jc.push_attribute(("w:val", alignment));
                w.write_event(Event::Empty(jc)).unwrap();
            }
            w.write_event(Event::End(BytesEnd::new("w:pPr"))).unwrap();
        }
    }

    fn write_paragraph_end(&mut self) {
        self.document
            .write_event(Event::End(BytesEnd::new("w:p")))
            .unwrap();
    }

    fn write_run_start(
        &mut self,
        bold: bool,
        italic: bool,
        strike: bool,
        superscript: bool,
        _description: bool,
    ) {
        let w = &mut self.document;
        w.write_event(Event::Start(BytesStart::new("w:r"))).unwrap();
        if bold || italic || strike || superscript {
            w.write_event(Event::Start(BytesStart::new("w:rPr")))
                .unwrap();
            if bold {
                w.write_event(Event::Empty(BytesStart::new("w:b")))
                    .unwrap();
            }
            if italic {
                w.write_event(Event::Empty(BytesStart::new("w:i")))
                    .unwrap();
            }
            if strike {
                w.write_event(Event::Empty(BytesStart::new("w:strike")))
                    .unwrap();
            }
            if superscript {
                w.write_event(Event::Empty(
                    BytesStart::new("w:vertAlign")
                        .with_attributes([("w:val", "superscript")]),
                ))
                .unwrap();
            }
            w.write_event(Event::End(BytesEnd::new("w:rPr"))).unwrap();
        }
    }

    fn write_run_end(&mut self) {
        self.document
            .write_event(Event::End(BytesEnd::new("w:r")))
            .unwrap();
    }

    fn write_text_run(&mut self, text: &str) {
        if text.is_empty() {
            return;
        }
        let w = &mut self.document;
        w.write_event(Event::Start(BytesStart::new("w:r"))).unwrap();
        w.write_event(Event::Start(BytesStart::new("w:t"))).unwrap();
        w.write_event(Event::Text(BytesText::new(text))).unwrap();
        w.write_event(Event::End(BytesEnd::new("w:t"))).unwrap();
        w.write_event(Event::End(BytesEnd::new("w:r"))).unwrap();
    }

    fn write_code_run(&mut self, code: &str) {
        let code_font = self.code_font_fallback();
        let code_bg = self.code_bg_fallback();
        let code_color = self.code_color_fallback();
        let w = &mut self.document;
        w.write_event(Event::Start(BytesStart::new("w:r"))).unwrap();
        w.write_event(Event::Start(BytesStart::new("w:rPr")))
            .unwrap();
        write_rfont(w, &code_font);
        if !code_color.is_empty() {
            let mut col = BytesStart::new("w:color");
            col.push_attribute(("w:val", code_color.as_str()));
            w.write_event(Event::Empty(col)).unwrap();
        }
        let mut shd = BytesStart::new("w:shd");
        shd.push_attribute(("w:val", "clear"));
        shd.push_attribute(("w:fill", code_bg.as_str()));
        w.write_event(Event::Empty(shd)).unwrap();
        write_sz(w, 20); // 10pt
        w.write_event(Event::End(BytesEnd::new("w:rPr"))).unwrap();
        w.write_event(Event::Start(BytesStart::new("w:t"))).unwrap();
        w.write_event(Event::Text(BytesText::new(code))).unwrap();
        w.write_event(Event::End(BytesEnd::new("w:t"))).unwrap();
        w.write_event(Event::End(BytesEnd::new("w:r"))).unwrap();
    }

    fn write_line_break(&mut self) {
        let w = &mut self.document;
        w.write_event(Event::Start(BytesStart::new("w:r"))).unwrap();
        w.write_event(Event::Empty(BytesStart::new("w:br"))).unwrap();
        w.write_event(Event::End(BytesEnd::new("w:r"))).unwrap();
    }

    fn write_thematic_break(&mut self) {
        let w = &mut self.document;
        w.write_event(Event::Start(BytesStart::new("w:p"))).unwrap();
        w.write_event(Event::Start(BytesStart::new("w:pPr")))
            .unwrap();
        w.write_event(Event::Start(BytesStart::new("w:pBdr")))
            .unwrap();
        let mut bottom = BytesStart::new("w:bottom");
        bottom.push_attribute(("w:val", "single"));
        bottom.push_attribute(("w:sz", "6"));
        bottom.push_attribute(("w:space", "1"));
        bottom.push_attribute(("w:color", "auto"));
        w.write_event(Event::Empty(bottom)).unwrap();
        w.write_event(Event::End(BytesEnd::new("w:pBdr"))).unwrap();
        w.write_event(Event::End(BytesEnd::new("w:pPr"))).unwrap();
        w.write_event(Event::End(BytesEnd::new("w:p"))).unwrap();
    }

    fn code_font_fallback(&self) -> String {
        if self.theme.code_font.is_empty() {
            "Consolas".to_string()
        } else {
            self.theme.code_font.clone()
        }
    }

    fn code_bg_fallback(&self) -> String {
        if self.theme.code_bg.is_empty() {
            "F5F5F5".to_string()
        } else {
            self.theme.code_bg.clone()
        }
    }

    fn code_color_fallback(&self) -> String {
        // Falls back to body_color for consistency with WYSIWYG (both use --mid-10).
        // If both are empty, no color override is applied.
        if !self.theme.code_color.is_empty() {
            self.theme.code_color.clone()
        } else if !self.theme.body_color.is_empty() {
            self.theme.body_color.clone()
        } else {
            String::new()
        }
    }

    fn write_code_block(&mut self, lang: &str, code: &str) {
        let code_font = self.code_font_fallback();
        let code_color = self.code_color_fallback();
        let _code_bg = self.code_bg_fallback(); // kept for future use (bg rect not avail via OOXML pStyle shading)
        let w = &mut self.document;

        // Language label line (if present)
        if !lang.is_empty() {
            w.write_event(Event::Start(BytesStart::new("w:p"))).unwrap();
            w.write_event(Event::Start(BytesStart::new("w:pPr")))
                .unwrap();
            w.write_event(Event::End(BytesEnd::new("w:pPr"))).unwrap();

            // lang label run — smaller, muted, italic
            w.write_event(Event::Start(BytesStart::new("w:r"))).unwrap();
            w.write_event(Event::Start(BytesStart::new("w:rPr")))
                .unwrap();
            write_rfont(w, &code_font);
            let mut color = BytesStart::new("w:color");
            color.push_attribute(("w:val", "888888"));
            w.write_event(Event::Empty(color)).unwrap();
            w.write_event(Event::Empty(BytesStart::new("w:i")))
                .unwrap();
            write_sz(w, 16); // 8pt
            w.write_event(Event::End(BytesEnd::new("w:rPr"))).unwrap();
            w.write_event(Event::Start(BytesStart::new("w:t"))).unwrap();
            w.write_event(Event::Text(BytesText::new(lang))).unwrap();
            w.write_event(Event::End(BytesEnd::new("w:t"))).unwrap();
            w.write_event(Event::End(BytesEnd::new("w:r"))).unwrap();

            w.write_event(Event::End(BytesEnd::new("w:p"))).unwrap();
        }

        // Code content block — each line in its own run with a line break between
        w.write_event(Event::Start(BytesStart::new("w:p"))).unwrap();
        let mut p_style = BytesStart::new("w:pStyle");
        p_style.push_attribute(("w:val", "Code"));
        w.write_event(Event::Start(BytesStart::new("w:pPr")))
            .unwrap();
        w.write_event(Event::Empty(p_style)).unwrap();
        w.write_event(Event::End(BytesEnd::new("w:pPr"))).unwrap();

        let lines: Vec<&str> = code.lines().collect();
        for (i, line) in lines.iter().enumerate() {
            w.write_event(Event::Start(BytesStart::new("w:r"))).unwrap();
            w.write_event(Event::Start(BytesStart::new("w:rPr")))
                .unwrap();
            write_rfont(w, &code_font);
            if !code_color.is_empty() {
                let mut col = BytesStart::new("w:color");
                col.push_attribute(("w:val", code_color.as_str()));
                w.write_event(Event::Empty(col)).unwrap();
            }
            write_sz(w, 19); // 9.5pt
            w.write_event(Event::End(BytesEnd::new("w:rPr"))).unwrap();
            w.write_event(Event::Start(BytesStart::new("w:t"))).unwrap();
            w.write_event(Event::Text(BytesText::new(line))).unwrap();
            w.write_event(Event::End(BytesEnd::new("w:t"))).unwrap();
            w.write_event(Event::End(BytesEnd::new("w:r"))).unwrap();
            // Line break between code lines
            if i < lines.len() - 1 {
                w.write_event(Event::Start(BytesStart::new("w:r"))).unwrap();
                w.write_event(Event::Empty(BytesStart::new("w:br"))).unwrap();
                w.write_event(Event::End(BytesEnd::new("w:r"))).unwrap();
            }
        }

        w.write_event(Event::End(BytesEnd::new("w:p"))).unwrap();
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Hyperlink
// ═══════════════════════════════════════════════════════════════════════

impl DocxWriter {
    fn write_hyperlink<'a>(&mut self, url: &str, node: &'a AstNode<'a>, base_path: &str) {
        self.rel_id_counter += 1;
        let rid = format!("rId{}", self.rel_id_counter);

        // Register relationship
        self.rels_entries.push(RelEntry {
            id: rid.clone(),
            rel_type:
                "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink"
                    .to_string(),
            target: url.to_string(),
            target_mode: Some("External".to_string()),
        });

        let mut hyperlink = BytesStart::new("w:hyperlink");
        hyperlink.push_attribute(("r:id", rid.as_str()));
        self.document
            .write_event(Event::Start(hyperlink))
            .unwrap();

        for child in node.children() {
            self.walk_ast(child, base_path);
        }

        self.document
            .write_event(Event::End(BytesEnd::new("w:hyperlink")))
            .unwrap();
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Table
// ═══════════════════════════════════════════════════════════════════════

impl DocxWriter {
    fn write_table<'a>(&mut self, node: &'a AstNode<'a>, base_path: &str) {
        self.document
            .write_event(Event::Start(BytesStart::new("w:tbl")))
            .unwrap();

        // Count columns from first row
        let col_count = node
            .children()
            .next()
            .and_then(|row| match &row.data.borrow().value {
                NodeValue::TableRow(_) => {
                    let n = row.children().count();
                    if n > 0 {
                        Some(n)
                    } else {
                        None
                    }
                }
                _ => None,
            })
            .unwrap_or(1);

        // Table width: standard US letter text area (8.5" - 2×1" margins = 6.5" = 9360 twips)
        const PAGE_TEXT_WIDTH: u32 = 9360;
        let col_width = (PAGE_TEXT_WIDTH / col_count as u32).max(500);
        let col_width_str = col_width.to_string();
        let page_w_str = PAGE_TEXT_WIDTH.to_string();

        // Table properties
        self.document
            .write_event(Event::Start(BytesStart::new("w:tblPr")))
            .unwrap();
        // Full-page table width
        let mut tblw = BytesStart::new("w:tblW");
        tblw.push_attribute(("w:w", page_w_str.as_str()));
        tblw.push_attribute(("w:type", "dxa"));
        self.document.write_event(Event::Empty(tblw)).unwrap();
        // Center table on page
        let mut tbl_jc = BytesStart::new("w:jc");
        tbl_jc.push_attribute(("w:val", "center"));
        self.document.write_event(Event::Empty(tbl_jc)).unwrap();
        // Borders
        self.document
            .write_event(Event::Start(BytesStart::new("w:tblBorders")))
            .unwrap();
        for side in &["top", "left", "bottom", "right", "insideH", "insideV"] {
            let side_name = format!("w:{}", side);
            let mut border = BytesStart::new(&side_name);
            border.push_attribute(("w:val", "single"));
            border.push_attribute(("w:sz", "4"));
            border.push_attribute(("w:color", "auto"));
            self.document.write_event(Event::Empty(border)).unwrap();
        }
        self.document
            .write_event(Event::End(BytesEnd::new("w:tblBorders")))
            .unwrap();
        self.document
            .write_event(Event::End(BytesEnd::new("w:tblPr")))
            .unwrap();

        // Table grid (column definitions)
        self.document
            .write_event(Event::Start(BytesStart::new("w:tblGrid")))
            .unwrap();
        for _ in 0..col_count {
            let mut gc = BytesStart::new("w:gridCol");
            gc.push_attribute(("w:w", col_width_str.as_str()));
            self.document.write_event(Event::Empty(gc)).unwrap();
        }
        self.document
            .write_event(Event::End(BytesEnd::new("w:tblGrid")))
            .unwrap();

        // Rows
        for child in node.children() {
            if let NodeValue::TableRow(_) = &child.data.borrow().value {
                self.document
                    .write_event(Event::Start(BytesStart::new("w:tr")))
                    .unwrap();
                for cell in child.children() {
                    self.document
                        .write_event(Event::Start(BytesStart::new("w:tc")))
                        .unwrap();
                    // Cell width matching column width
                    let mut tcw = BytesStart::new("w:tcW");
                    tcw.push_attribute(("w:w", col_width_str.as_str()));
                    tcw.push_attribute(("w:type", "dxa"));
                    self.document.write_event(Event::Empty(tcw)).unwrap();

                    self.document
                        .write_event(Event::Start(BytesStart::new("w:p")))
                        .unwrap();
                    // Center cell content horizontally
                    self.document
                        .write_event(Event::Start(BytesStart::new("w:pPr")))
                        .unwrap();
                    let mut cell_jc = BytesStart::new("w:jc");
                    cell_jc.push_attribute(("w:val", "center"));
                    self.document
                        .write_event(Event::Empty(cell_jc))
                        .unwrap();
                    self.document
                        .write_event(Event::End(BytesEnd::new("w:pPr")))
                        .unwrap();
                    for cell_child in cell.children() {
                        self.walk_ast(cell_child, base_path);
                    }
                    self.document
                        .write_event(Event::End(BytesEnd::new("w:p")))
                        .unwrap();
                    self.document
                        .write_event(Event::End(BytesEnd::new("w:tc")))
                        .unwrap();
                }
                self.document
                    .write_event(Event::End(BytesEnd::new("w:tr")))
                    .unwrap();
            }
        }

        self.document
            .write_event(Event::End(BytesEnd::new("w:tbl")))
            .unwrap();
    }
}

// ═══════════════════════════════════════════════════════════════════════
// List item writing (with numbering)
// ═══════════════════════════════════════════════════════════════════════

impl DocxWriter {
    fn write_list_item(&mut self, ordered: bool, _start: u64, checked: bool, is_task: bool) {
        self.document
            .write_event(Event::Start(BytesStart::new("w:p")))
            .unwrap();
        self.document
            .write_event(Event::Start(BytesStart::new("w:pPr")))
            .unwrap();

        let num_id = if ordered { 1u32 } else { 2u32 };
        self.document
            .write_event(Event::Start(BytesStart::new("w:numPr")))
            .unwrap();
        let mut ilvl = BytesStart::new("w:ilvl");
        ilvl.push_attribute(("w:val", "0"));
        self.document.write_event(Event::Empty(ilvl)).unwrap();
        let mut num_id_elem = BytesStart::new("w:numId");
        num_id_elem.push_attribute(("w:val", num_id.to_string().as_str()));
        self.document
            .write_event(Event::Empty(num_id_elem))
            .unwrap();
        self.document
            .write_event(Event::End(BytesEnd::new("w:numPr")))
            .unwrap();

        self.document
            .write_event(Event::End(BytesEnd::new("w:pPr")))
            .unwrap();

        if checked {
            self.write_text_run("☑ ");
        } else if is_task {
            self.write_text_run("☐ ");
        }
    }

    fn write_numbering(&mut self) -> Result<(), String> {
        self.numbering
            .write_event(Event::Decl(BytesDecl::new("1.0", Some("UTF-8"), None)))
            .map_err(|e| e.to_string())?;
        self.numbering
            .write_event(Event::Start(
                BytesStart::new("w:numbering").with_attributes([(
                    "xmlns:w",
                    "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
                )]),
            ))
            .map_err(|e| e.to_string())?;

        // Abstract numbering 1: ordered (decimal)
        self.write_abstract_num(1, "decimal")?;
        // Abstract numbering 2: unordered (bullet)
        self.write_abstract_num(2, "bullet")?;

        // Numbering instances
        self.write_num_instance(1, 1)?;
        self.write_num_instance(2, 2)?;

        self.numbering
            .write_event(Event::End(BytesEnd::new("w:numbering")))
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn write_abstract_num(&mut self, id: u32, fmt: &str) -> Result<(), String> {
        let w = &mut self.numbering;
        let mut abs = BytesStart::new("w:abstractNum");
        abs.push_attribute(("w:abstractNumId", id.to_string().as_str()));
        w.write_event(Event::Start(abs)).map_err(|e| e.to_string())?;

        // Level 0
        w.write_event(Event::Start(
            BytesStart::new("w:lvl").with_attributes([("w:ilvl", "0")]),
        ))
        .map_err(|e| e.to_string())?;
        let mut start = BytesStart::new("w:start");
        start.push_attribute(("w:val", "1"));
        w.write_event(Event::Empty(start)).map_err(|e| e.to_string())?;
        let mut numfmt = BytesStart::new("w:numFmt");
        numfmt.push_attribute(("w:val", fmt));
        w.write_event(Event::Empty(numfmt))
            .map_err(|e| e.to_string())?;
        let mut lvl_text = BytesStart::new("w:lvlText");
        lvl_text.push_attribute((
            "w:val",
            if fmt == "bullet" { "\u{2022}" } else { "%1" },
        ));
        w.write_event(Event::Empty(lvl_text))
            .map_err(|e| e.to_string())?;
        let mut lvl_jc = BytesStart::new("w:lvlJc");
        lvl_jc.push_attribute(("w:val", "left"));
        w.write_event(Event::Empty(lvl_jc))
            .map_err(|e| e.to_string())?;
        w.write_event(Event::End(BytesEnd::new("w:lvl")))
            .map_err(|e| e.to_string())?;

        w.write_event(Event::End(BytesEnd::new("w:abstractNum")))
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn write_num_instance(&mut self, instance_id: u32, abstract_id: u32) -> Result<(), String> {
        let w = &mut self.numbering;
        let mut num = BytesStart::new("w:num");
        num.push_attribute(("w:numId", instance_id.to_string().as_str()));
        w.write_event(Event::Start(num)).map_err(|e| e.to_string())?;
        let mut abs_ref = BytesStart::new("w:abstractNumId");
        abs_ref.push_attribute(("w:val", abstract_id.to_string().as_str()));
        w.write_event(Event::Empty(abs_ref))
            .map_err(|e| e.to_string())?;
        w.write_event(Event::End(BytesEnd::new("w:num")))
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

// ═══════════════════════════════════════════════════════════════════════
// OOXML boilerplate: [Content_Types].xml
// ═══════════════════════════════════════════════════════════════════════

impl DocxWriter {
    fn write_content_types(&mut self) -> Result<(), String> {
        let w = &mut self.content_types;
        w.write_event(Event::Decl(BytesDecl::new("1.0", Some("UTF-8"), None)))
            .map_err(|e| e.to_string())?;
        w.write_event(Event::Start(
            BytesStart::new("Types").with_attributes([(
                "xmlns",
                "http://schemas.openxmlformats.org/package/2006/content-types",
            )]),
        ))
        .map_err(|e| e.to_string())?;

        // Default content types
        for (ext, ct) in &[
            (
                "rels",
                "application/vnd.openxmlformats-package.relationships+xml",
            ),
            ("xml", "application/xml"),
            ("svg", "image/svg+xml"),
        ] {
            let mut elem = BytesStart::new("Default");
            elem.push_attribute(("Extension", *ext));
            elem.push_attribute(("ContentType", *ct));
            w.write_event(Event::Empty(elem))
                .map_err(|e| e.to_string())?;
        }

        // Override content types
        let mut overrides: Vec<(&str, &str)> = vec![
            (
                "/word/document.xml",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
            ),
            (
                "/word/styles.xml",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml",
            ),
            (
                "/word/numbering.xml",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml",
            ),
            (
                "/docProps/core.xml",
                "application/vnd.openxmlformats-package.core-properties+xml",
            ),
            (
                "/docProps/app.xml",
                "application/vnd.openxmlformats-officedocument.extended-properties+xml",
            ),
        ];
        if !self.footnote_defs.is_empty() {
            overrides.push((
                "/word/footnotes.xml",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml",
            ));
        }
        for (part, ct) in &overrides {
            let mut elem = BytesStart::new("Override");
            elem.push_attribute(("PartName", *part));
            elem.push_attribute(("ContentType", *ct));
            w.write_event(Event::Empty(elem))
                .map_err(|e| e.to_string())?;
        }

        w.write_event(Event::End(BytesEnd::new("Types")))
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

// ═══════════════════════════════════════════════════════════════════════
// OOXML boilerplate: word/_rels/document.xml.rels
// ═══════════════════════════════════════════════════════════════════════

impl DocxWriter {
    /// Collect static word/document.xml relationship entries.
    /// Called after footnotes are known (after collect_footnotes).
    fn collect_rels(&mut self) -> Result<(), String> {
        self.add_rel_entry(
            "styles",
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles",
            "styles.xml",
            None,
        )?;
        self.add_rel_entry(
            "numbering",
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering",
            "numbering.xml",
            None,
        )?;
        if !self.footnote_defs.is_empty() {
            self.add_rel_entry(
                "footnotes",
                "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes",
                "footnotes.xml",
                None,
            )?;
        }
        Ok(())
    }

    fn add_rel_entry(
        &mut self,
        _id_suffix: &str,
        rel_type: &str,
        target: &str,
        target_mode: Option<&str>,
    ) -> Result<(), String> {
        self.rel_id_counter += 1;
        let rid = format!("rId{}", self.rel_id_counter);
        self.rels_entries.push(RelEntry {
            id: rid,
            rel_type: rel_type.to_string(),
            target: target.to_string(),
            target_mode: target_mode.map(|s| s.to_string()),
        });
        Ok(())
    }

    /// Write the complete word/_rels/document.xml.rels XML content.
    fn render_rels_xml(&self) -> Result<Vec<u8>, String> {
        let mut w = Writer::new_with_indent(Vec::new(), b' ', 2);
        w.write_event(Event::Decl(BytesDecl::new("1.0", Some("UTF-8"), None)))
            .map_err(|e| e.to_string())?;
        w.write_event(Event::Start(
            BytesStart::new("Relationships").with_attributes([(
                "xmlns",
                "http://schemas.openxmlformats.org/package/2006/relationships",
            )]),
        ))
        .map_err(|e| e.to_string())?;

        for entry in &self.rels_entries {
            let mut elem = BytesStart::new("Relationship");
            elem.push_attribute(("Id", entry.id.as_str()));
            elem.push_attribute(("Type", entry.rel_type.as_str()));
            elem.push_attribute(("Target", entry.target.as_str()));
            if let Some(ref mode) = entry.target_mode {
                elem.push_attribute(("TargetMode", mode.as_str()));
            }
            w.write_event(Event::Empty(elem))
                .map_err(|e| e.to_string())?;
        }

        w.write_event(Event::End(BytesEnd::new("Relationships")))
            .map_err(|e| e.to_string())?;
        Ok(w.into_inner())
    }
}

// ═══════════════════════════════════════════════════════════════════════
// ZIP packaging: finalize_zip
// ═══════════════════════════════════════════════════════════════════════

impl DocxWriter {
    fn finalize_zip(&mut self) -> Result<Vec<u8>, String> {
        use zip::write::FileOptions;
        use zip::ZipWriter;

        let mut buf = Vec::new();
        let mut zip = ZipWriter::new(std::io::Cursor::new(&mut buf));

        let options: FileOptions<'_, ()> =
            FileOptions::default().compression_method(zip::CompressionMethod::Deflated);

        // [Content_Types].xml
        zip.start_file("[Content_Types].xml", options)
            .map_err(|e| e.to_string())?;
        zip.write_all(self.content_types.get_ref())
            .map_err(|e| e.to_string())?;

        // _rels/.rels — package-level relationships (mandatory)
        zip.add_directory("_rels/", FileOptions::<'_, ()>::default())
            .map_err(|e| e.to_string())?;
        zip.start_file("_rels/.rels", options)
            .map_err(|e| e.to_string())?;
        write!(
            zip,
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/extended-properties" Target="docProps/app.xml"/>
</Relationships>"#,
        )
        .map_err(|e| e.to_string())?;

        // docProps
        zip.add_directory("docProps/", FileOptions::<'_, ()>::default())
            .map_err(|e| e.to_string())?;
        zip.start_file("docProps/app.xml", options)
            .map_err(|e| e.to_string())?;
        write!(
            zip,
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
<Application>RMD</Application>
</Properties>"#,
        )
        .map_err(|e| e.to_string())?;

        zip.start_file("docProps/core.xml", options)
            .map_err(|e| e.to_string())?;
        write!(
            zip,
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:dcterms="http://purl.org/dc/terms/">
<dc:creator>RMD</dc:creator>
<dc:title>RMD Document</dc:title>
</cp:coreProperties>"#,
        )
        .map_err(|e| e.to_string())?;

        // word/
        zip.add_directory("word/", FileOptions::<'_, ()>::default())
            .map_err(|e| e.to_string())?;
        zip.add_directory("word/_rels/", FileOptions::<'_, ()>::default())
            .map_err(|e| e.to_string())?;

        zip.start_file("word/_rels/document.xml.rels", options)
            .map_err(|e| e.to_string())?;
        let rels_bytes = self.render_rels_xml()?;
        zip.write_all(&rels_bytes)
            .map_err(|e| e.to_string())?;

        zip.start_file("word/document.xml", options)
            .map_err(|e| e.to_string())?;
        zip.write_all(self.document.get_ref())
            .map_err(|e| e.to_string())?;

        zip.start_file("word/styles.xml", options)
            .map_err(|e| e.to_string())?;
        zip.write_all(self.styles.get_ref())
            .map_err(|e| e.to_string())?;

        // numbering.xml
        self.write_numbering()?;
        zip.start_file("word/numbering.xml", options)
            .map_err(|e| e.to_string())?;
        zip.write_all(self.numbering.get_ref())
            .map_err(|e| e.to_string())?;

        // footnotes (if any)
        if let Some(fn_writer) = self.footnotes.as_mut() {
            zip.start_file("word/footnotes.xml", options)
                .map_err(|e| e.to_string())?;
            zip.write_all(fn_writer.get_ref())
                .map_err(|e| e.to_string())?;
        }

        // Images
        if !self.images.is_empty() {
            zip.add_directory("word/media/", FileOptions::<'_, ()>::default())
                .map_err(|e| e.to_string())?;
            for (name, data) in &self.images {
                zip.start_file(format!("word/media/{}", name), options)
                    .map_err(|e| e.to_string())?;
                zip.write_all(data).map_err(|e| e.to_string())?;
            }
        }

        zip.finish().map_err(|e| e.to_string())?;

        Ok(buf)
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;
    use super::images::svg_to_png;

    #[test]
    fn test_generate_minimal_docx() {
        let md = "# Hello\n\nWorld";
        let result = generate(md, "", "");
        assert!(result.is_ok(), "generate failed: {:?}", result.err());
        let bytes = result.unwrap();

        use zip::ZipArchive;
        use std::io::Cursor;
        let mut archive =
            ZipArchive::new(Cursor::new(bytes)).expect("Output must be a valid ZIP archive");

        let required = [
            "[Content_Types].xml",
            "word/document.xml",
            "word/styles.xml",
        ];
        for name in &required {
            assert!(
                archive.by_name(name).is_ok(),
                "Missing required OOXML entry: {}",
                name
            );
        }
    }

    #[test]
    fn test_generate_headings() {
        let md = "# H1\n## H2\n### H3\nParagraph text\n\n**bold** *italic* `code`";
        let bytes = generate(md, "", "").unwrap();
        use zip::ZipArchive;
        use std::io::Cursor;
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
        let doc = archive.by_name("word/document.xml").unwrap();
        let content = std::io::read_to_string(doc).unwrap();
        assert!(content.contains("Heading1"), "Should have Heading1 style");
        assert!(content.contains("Heading2"), "Should have Heading2 style");
        assert!(content.contains("Heading3"), "Should have Heading3 style");
        assert!(content.contains("w:b"), "Should have bold");
        assert!(content.contains("w:i"), "Should have italic");
        assert!(content.contains("Consolas"), "Should have code font");
    }

    #[test]
    fn test_generate_inline_formatting() {
        let md = "**bold** *italic* `code` ~~strike~~ normal";
        let bytes = generate(md, "", "").unwrap();
        use zip::ZipArchive;
        use std::io::Cursor;
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
        let doc =
            std::io::read_to_string(archive.by_name("word/document.xml").unwrap()).unwrap();
        assert!(doc.contains("w:b"), "Should have bold");
        assert!(doc.contains("w:i"), "Should have italic");
        assert!(doc.contains("Consolas"), "Should have inline code font");
        assert!(doc.contains("w:strike"), "Should have strikethrough");
    }

    #[test]
    fn test_generate_table() {
        let md = "| H1 | H2 |\n|---|---|\n| A | B |";
        let bytes = generate(md, "", "").unwrap();
        use zip::ZipArchive;
        use std::io::Cursor;
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
        let doc =
            std::io::read_to_string(archive.by_name("word/document.xml").unwrap()).unwrap();
        assert!(doc.contains("w:tbl"), "Should have table");
        assert!(doc.contains("H1"), "Header should be in document");
        assert!(doc.contains("A"), "Cell content should be in document");
    }

    #[test]
    fn test_generate_lists() {
        let md = "- Item 1\n- Item 2\n\n1. One\n2. Two";
        let bytes = generate(md, "", "").unwrap();
        use zip::ZipArchive;
        use std::io::Cursor;
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
        let doc =
            std::io::read_to_string(archive.by_name("word/document.xml").unwrap()).unwrap();
        assert!(doc.contains("Item 1"), "Bullet item");
        assert!(doc.contains("One"), "Ordered item");
        assert!(
            archive.by_name("word/numbering.xml").is_ok(),
            "Should have numbering.xml"
        );
    }

    #[test]
    fn test_generate_links() {
        let md = "[Example](https://example.com)";
        let bytes = generate(md, "", "").unwrap();
        use zip::ZipArchive;
        use std::io::Cursor;
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
        let doc =
            std::io::read_to_string(archive.by_name("word/document.xml").unwrap()).unwrap();
        assert!(doc.contains("w:hyperlink"), "Should have hyperlink");
        assert!(doc.contains("Example"), "Link text should be present");
        // Verify the hyperlink relationship is inside well-formed XML
        let rels =
            std::io::read_to_string(archive.by_name("word/_rels/document.xml.rels").unwrap())
                .unwrap();
        assert!(rels.contains("hyperlink"), "Rels should contain hyperlink entry");
        // Verify there is no Relationship after </Relationships>
        assert!(
            !rels.contains("</Relationships>\n  <Relationship"),
            "No relationships after closing tag"
        );
    }

    #[test]
    fn test_generate_blockquote() {
        let md = "> This is a quote";
        let bytes = generate(md, "", "").unwrap();
        use zip::ZipArchive;
        use std::io::Cursor;
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
        let doc =
            std::io::read_to_string(archive.by_name("word/document.xml").unwrap()).unwrap();
        assert!(doc.contains("Quote"), "Should use Quote style");
    }

    #[test]
    fn test_generate_with_image() {
        let md = "![test](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==)";
        let bytes = generate(md, "", "").unwrap();
        use zip::ZipArchive;
        use std::io::Cursor;
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
        assert!(
            archive.by_name("word/media/image1.png").is_ok(),
            "Image should be embedded"
        );
        // Verify the image relationship is inside well-formed rels XML
        let rels =
            std::io::read_to_string(archive.by_name("word/_rels/document.xml.rels").unwrap())
                .unwrap();
        assert!(
            rels.contains("media/image1.png"),
            "Rels should reference media/image1.png"
        );
        // Verify no trailing rels after closing tag
        assert!(
            !rels.contains("</Relationships>\n  <Relationship"),
            "No relationships after closing tag"
        );
    }

    #[test]
    fn test_document_rels_well_formed() {
        let md = "# Hello\n\n**bold** [link](https://example.com) ![img](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==)";
        let bytes = generate(md, "", "").unwrap();
        use zip::ZipArchive;
        use std::io::Cursor;
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
        let rels =
            std::io::read_to_string(archive.by_name("word/_rels/document.xml.rels").unwrap())
                .unwrap();

        // Must have exactly one top-level <Relationships> element
        let open_count = rels
            .lines()
            .filter(|l| l.starts_with("<Relationships"))
            .count();
        assert_eq!(open_count, 1, "Single <Relationships> opening");
        assert_eq!(
            rels.matches("</Relationships>").count(),
            1,
            "Single </Relationships> closing"
        );

        // All Relationship entries must be self-closing empties
        assert!(
            !rels.contains("</Relationship>"),
            "No non-empty Relationship elements"
        );

        // Should include styles, numbering, image, and hyperlink references
        assert!(rels.contains("styles.xml"), "Rels must reference styles.xml");
        assert!(
            rels.contains("hyperlink"),
            "Rels must reference hyperlink (External)"
        );
        assert!(
            rels.contains("media/image1.png"),
            "Rels must reference image"
        );
        assert!(
            rels.contains("TargetMode=\"External\""),
            "Hyperlink should have TargetMode=\"External\""
        );
    }

    #[test]
    fn test_generate_wikilinks() {
        let md = "[[Page]] and [[Other|Display]]";
        let bytes = generate(md, "", "").unwrap();
        use zip::ZipArchive;
        use std::io::Cursor;
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
        let doc =
            std::io::read_to_string(archive.by_name("word/document.xml").unwrap()).unwrap();
        assert!(doc.contains("Page"), "Wikilink target should render as text");
        assert!(
            doc.contains("Display"),
            "Wikilink alias should render as text"
        );
        assert!(
            !doc.contains("[[Page]]"),
            "Raw wikilink syntax should NOT appear"
        );
    }

    #[test]
    fn test_generate_tasklist() {
        let md = "- [ ] Unchecked\n- [x] Checked";
        let bytes = generate(md, "", "").unwrap();
        use zip::ZipArchive;
        use std::io::Cursor;
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
        let doc =
            std::io::read_to_string(archive.by_name("word/document.xml").unwrap()).unwrap();
        assert!(doc.contains("Unchecked"), "Unchecked item text");
        assert!(doc.contains("Checked"), "Checked item text");
        assert!(!doc.contains("[ ]"), "Raw unchecked marker should be stripped");
        assert!(
            !doc.contains("[x]"),
            "Raw checked marker should be stripped (case-insensitive)"
        );
    }

    #[test]
    fn test_generate_codeblock_with_lang() {
        let md = "```rust\nfn main() {}\n```";
        let bytes = generate(md, "", "").unwrap();
        use zip::ZipArchive;
        use std::io::Cursor;
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
        let doc =
            std::io::read_to_string(archive.by_name("word/document.xml").unwrap()).unwrap();
        assert!(doc.contains("rust"), "Language label should appear");
        assert!(doc.contains("Code"), "Should use Code style");
    }

    #[test]
    fn test_generate_cjk() {
        let md = "# 中文标题\n\n这是中文段落。";
        let bytes = generate(md, "", "").unwrap();
        use zip::ZipArchive;
        use std::io::Cursor;
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
        let doc =
            std::io::read_to_string(archive.by_name("word/document.xml").unwrap()).unwrap();
        assert!(
            doc.contains("中文标题"),
            "CJK heading text should render"
        );
        assert!(
            doc.contains("这是中文段落"),
            "CJK paragraph text should render"
        );
    }

    #[test]
    fn test_generate_empty() {
        let result = generate("", "", "");
        assert!(
            result.is_ok(),
            "Empty input should produce valid minimal docx, got: {:?}",
            result.err()
        );
        let bytes = result.unwrap();
        use zip::ZipArchive;
        use std::io::Cursor;
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
        assert!(archive.by_name("[Content_Types].xml").is_ok());
        assert!(archive.by_name("word/document.xml").is_ok());
    }

    #[test]
    fn test_generate_footnotes() {
        let md = "Text[^1] more text.\n\n[^1]: Footnote content here.";
        let bytes = generate(md, "", "").unwrap();
        use zip::ZipArchive;
        use std::io::Cursor;
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
        let doc =
            std::io::read_to_string(archive.by_name("word/document.xml").unwrap()).unwrap();
        assert!(
            doc.contains("footnoteReference"),
            "Should have footnote reference"
        );
    }

    #[test]
    fn test_docx_is_valid_zip() {
        let md = "# Hello\n\nWorld\n\n- Item 1\n- Item 2\n\n[^1]: A footnote.";
        let bytes = generate(md, "", "").unwrap();
        use zip::ZipArchive;
        use std::io::Cursor;
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();

        let required = [
            "[Content_Types].xml",
            "_rels/.rels",
            "word/document.xml",
            "word/styles.xml",
            "word/_rels/document.xml.rels",
        ];
        for name in &required {
            assert!(archive.by_name(name).is_ok(), "Missing: {}", name);
        }
    }

    #[test]
    fn test_svg_to_png_with_cjk_text() {
        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200">
  <rect width="400" height="200" fill="white"/>
  <text x="200" y="60" text-anchor="middle" font-size="24" font-family="sans-serif" fill="#333">Hello 世界</text>
  <text x="200" y="120" text-anchor="middle" font-size="20" font-family="sans-serif" fill="#555">开始 → 结束</text>
  <rect x="100" y="150" width="200" height="30" rx="5" fill="#4f6ef7"/>
  <text x="200" y="170" text-anchor="middle" font-size="14" font-family="sans-serif" fill="white">测试按钮</text>
</svg>"##;
        let png = svg_to_png(svg.as_bytes(), 1.0);
        assert!(png.is_some(), "svg_to_png returned None — CJK text may fail");
        let (png, _ow, _oh) = png.unwrap();
        assert!(!png.is_empty(), "svg_to_png returned empty PNG");
        assert_eq!(&png[..8], &[137, 80, 78, 71, 13, 10, 26, 10], "Not a valid PNG");
        assert!(png.len() > 1000, "PNG too small: {} bytes", png.len());
    }

    #[test]
    fn test_svg_to_png_mermaid_style() {
        // SVG with CSS <style> block — fill from CSS ONLY (no inline fill), like mermaid.
        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="400" height="200" viewBox="0 0 400 200">
  <defs>
    <marker id="arrowhead" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#999"/>
    </marker>
    <style>
      .node rect { fill: #4f6ef7; rx: 5px; }
      .nodeLabel { font-family: sans-serif; font-size: 14px; fill: white; }
      .edgePath path { stroke: #999; fill: none; marker-end: url(#arrowhead); }
      .edgeLabel { font-family: sans-serif; font-size: 12px; fill: #666; }
    </style>
  </defs>
  <rect width="400" height="200" fill="white"/>
  <g class="node">
    <rect x="20" y="20" width="160" height="40" rx="5"/>
    <text x="100" y="46" text-anchor="middle" class="nodeLabel">开始</text>
  </g>
  <g class="edgePath">
    <path d="M 100 60 L 100 100"/>
  </g>
  <g class="node">
    <rect x="20" y="100" width="160" height="40" rx="5"/>
    <text x="100" y="126" text-anchor="middle" class="nodeLabel">结束</text>
  </g>
</svg>"##;
        let png = svg_to_png(svg.as_bytes(), 1.0);
        assert!(png.is_some(), "svg_to_png returned None for mermaid-style SVG");
        let (png, _ow, _oh) = png.unwrap();
        assert!(!png.is_empty(), "svg_to_png returned empty PNG");
        assert_eq!(&png[..8], &[137, 80, 78, 71, 13, 10, 26, 10], "Not a valid PNG");
        assert!(png.len() > 1000, "PNG too small: {} bytes", png.len());
        eprintln!("mermaid-style SVG: CSS-only fill → {} byte PNG", png.len());
    }

    #[test]
    fn test_svg_to_png_mermaid_id_prefix_css() {
        // Mermaid prefixes CSS selectors with #container-id .classname
        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" id="rmd-mermaid-1" width="400" height="200" viewBox="0 0 400 200">
  <defs>
    <style>
      #rmd-mermaid-1 .nodeLabel { font-family: sans-serif; font-size: 14px; fill: white; }
      #rmd-mermaid-1 .edgePath path { stroke: #999; fill: none; }
    </style>
  </defs>
  <rect width="400" height="200" fill="#1a1a2e"/>
  <g class="node">
    <rect x="120" y="30" width="160" height="40" rx="5" fill="#4f6ef7"/>
    <text x="200" y="56" text-anchor="middle" class="nodeLabel">开始</text>
  </g>
  <g class="edgePath">
    <path d="M 200 70 L 200 110"/>
    <polygon points="195,105 200,120 205,105" fill="#999"/>
  </g>
  <g class="node">
    <rect x="120" y="120" width="160" height="40" rx="5" fill="#e74c3c"/>
    <text x="200" y="146" text-anchor="middle" class="nodeLabel">结束</text>
  </g>
</svg>"##;
        let png = svg_to_png(svg.as_bytes(), 1.0);
        assert!(
            png.is_some(),
            "svg_to_png returned None for mermaid ID-prefixed SVG"
        );
        let (png, _ow, _oh) = png.unwrap();
        assert_eq!(&png[..8], &[137, 80, 78, 71, 13, 10, 26, 10], "Not a valid PNG");
        assert!(png.len() > 1000, "PNG too small: {} bytes", png.len());
    }

    #[test]
    fn test_svg_to_png_foreignobject_loses_text() {
        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100" viewBox="0 0 300 100">
  <rect width="300" height="100" fill="#f0f0f0" rx="5"/>
  <foreignObject x="50" y="30" width="200" height="40">
    <div xmlns="http://www.w3.org/1999/xhtml" style="font-family:sans-serif;font-size:16px;color:#333;text-align:center;">
      <span>Hello 世界 in foreignObject</span>
    </div>
  </foreignObject>
</svg>"##;
        let png = svg_to_png(svg.as_bytes(), 1.0);
        assert!(
            png.is_some(),
            "svg_to_png returned None for foreignObject SVG"
        );
        let (png, _ow, _oh) = png.unwrap();
        assert_eq!(&png[..8], &[137, 80, 78, 71, 13, 10, 26, 10], "Not a valid PNG");
        eprintln!(
            "foreignObject SVG → PNG: {} bytes (text-LOSS expected: < 2000 without text)",
            png.len()
        );
    }

    #[test]
    fn test_svg_to_png_foreignobject_dropped_is_smaller() {
        let svg_fo = r##"<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100" viewBox="0 0 300 100">
  <rect width="300" height="100" fill="#f0f0f0" rx="5"/>
  <foreignObject x="50" y="30" width="200" height="40">
    <div xmlns="http://www.w3.org/1999/xhtml" style="font-family:sans-serif;font-size:16px;color:#333;">Hello 世界</div>
  </foreignObject>
</svg>"##;
        let svg_text = r##"<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100" viewBox="0 0 300 100">
  <rect width="300" height="100" fill="#f0f0f0" rx="5"/>
  <text x="150" y="55" text-anchor="middle" font-family="sans-serif" font-size="16" fill="#333">Hello 世界</text>
</svg>"##;
        let (png_fo, _ow, _oh) = svg_to_png(svg_fo.as_bytes(), 1.0).unwrap();
        let (png_text, _ow, _oh) = svg_to_png(svg_text.as_bytes(), 1.0).unwrap();
        assert!(
            png_text.len() > 2000,
            "Expected > 2000 bytes for <text> SVG, got {}",
            png_text.len()
        );
        eprintln!(
            "<text> SVG → {} bytes | <foreignObject> SVG → {} bytes",
            png_text.len(),
            png_fo.len()
        );
    }

    #[test]
    fn test_svg_data_uri_generates_png_in_docx() {
        // Integration test: full pipeline from markdown with SVG data URI to DOCX archive
        let svg_data = r##"<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">
  <rect width="200" height="100" fill="#f0f0f0" rx="10"/>
  <text x="100" y="55" text-anchor="middle" font-family="sans-serif" font-size="16" fill="#333">Hello 世界</text>
</svg>"##;
        let b64 =
            base64::Engine::encode(&base64::engine::general_purpose::STANDARD, svg_data.as_bytes());
        let md = format!("![test](data:image/svg+xml;base64,{})", b64);

        let bytes = generate(&md, "", "").unwrap();
        use zip::ZipArchive;
        use std::io::Cursor;
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();

        // Should produce a PNG (not SVG) in media
        assert!(
            archive.by_name("word/media/image1.png").is_ok(),
            "SVG data URI should produce PNG in DOCX media"
        );
        // The PNG should have reasonable size (> 500 bytes for visible content)
        let png_entry = archive.by_name("word/media/image1.png").unwrap();
        let png_size = png_entry.size();
        assert!(png_size > 500, "PNG too small: {} bytes", png_size);
        eprintln!(
            "DOCX integration: SVG→PNG produced {} bytes in DOCX media",
            png_size
        );
    }

    #[test]
    fn test_foreignobject_svg_embedded_as_svg_in_docx() {
        let svg_data = r##"<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 108 174" style="max-width:108px;">
  <style>#A .label{font-family:sans-serif;font-size:16px;fill:#333;}</style>
  <g class="node">
    <rect width="92" height="54" rx="5" fill="#fff" stroke="#e0e0e0"/>
    <g class="label" transform="translate(46,27)">
      <foreignObject width="60" height="24">
        <div xmlns="http://www.w3.org/1999/xhtml"><span class="nodeLabel">开始</span></div>
      </foreignObject>
    </g>
  </g>
</svg>"##;
        let b64 =
            base64::Engine::encode(&base64::engine::general_purpose::STANDARD, svg_data.as_bytes());
        let md = format!("![test](data:image/svg+xml;base64,{})", b64);

        let bytes = generate(&md, "", "").unwrap();
        use zip::ZipArchive;
        use std::io::Cursor;
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();

        // Should produce SVG (not PNG) in media — foreignObject detected
        let svg_entry = archive.by_name("word/media/image1.svg");
        assert!(
            svg_entry.is_ok(),
            "foreignObject SVG should produce .svg in DOCX media, not PNG"
        );
        let svg_content = std::io::read_to_string(svg_entry.unwrap()).unwrap();
        assert!(
            svg_content.contains("foreignObject"),
            "Embedded SVG must retain foreignObject"
        );
        assert!(svg_content.contains("开始"), "Embedded SVG must retain CJK text");

        // Check relationships
        let rels =
            std::io::read_to_string(archive.by_name("word/_rels/document.xml.rels").unwrap())
                .unwrap();
        assert!(
            rels.contains("image1.svg"),
            "Relationships must reference SVG file"
        );
        eprintln!("foreignObject SVG pipeline: embedded as SVG with CJK text preserved");
    }

    #[test]
    fn test_package_rels_references_document() {
        let md = "# Test";
        let bytes = generate(md, "", "").unwrap();
        use zip::ZipArchive;
        use std::io::Cursor;
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
        let rels =
            std::io::read_to_string(archive.by_name("_rels/.rels").unwrap()).unwrap();
        assert!(
            rels.contains("word/document.xml"),
            "Package rels must reference word/document.xml"
        );
        assert!(
            rels.contains("officeDocument"),
            "Package rels must have officeDocument type"
        );
        assert!(
            rels.contains("docProps/core.xml"),
            "Package rels must reference docProps/core.xml"
        );
    }
}
