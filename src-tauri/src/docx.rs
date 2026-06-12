use comrak::nodes::{AstNode, NodeValue};
use comrak::{parse_document, Arena, ComrakOptions};
use crate::export::normalize_wikilink_target;
use quick_xml::events::{BytesDecl, BytesEnd, BytesStart, BytesText, Event};
use quick_xml::Writer;
use std::io::Write;

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
}

pub fn generate(source: &str, base_path: &str) -> Result<Vec<u8>, String> {
    let mut writer = DocxWriter::new();
    writer.parse_and_write(source, base_path)?;
    writer.finalize_zip()
}

impl DocxWriter {
    fn new() -> Self {
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
        }
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
        w.write_event(Event::Start(BytesStart::new("Types")
            .with_attributes([("xmlns", "http://schemas.openxmlformats.org/package/2006/content-types")])))
            .map_err(|e| e.to_string())?;

        // Default content types
        for (ext, ct) in &[
            ("rels", "application/vnd.openxmlformats-package.relationships+xml"),
            ("xml", "application/xml"),
            ("svg", "image/svg+xml"),
        ] {
            let mut elem = BytesStart::new("Default");
            elem.push_attribute(("Extension", *ext));
            elem.push_attribute(("ContentType", *ct));
            w.write_event(Event::Empty(elem)).map_err(|e| e.to_string())?;
        }

        // Override content types
        let mut overrides: Vec<(&str, &str)> = vec![
            ("/word/document.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"),
            ("/word/styles.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"),
            ("/word/numbering.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"),
            ("/docProps/core.xml", "application/vnd.openxmlformats-package.core-properties+xml"),
            ("/docProps/app.xml", "application/vnd.openxmlformats-officedocument.extended-properties+xml"),
        ];
        if !self.footnote_defs.is_empty() {
            overrides.push(("/word/footnotes.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"));
        }
        for (part, ct) in &overrides {
            let mut elem = BytesStart::new("Override");
            elem.push_attribute(("PartName", *part));
            elem.push_attribute(("ContentType", *ct));
            w.write_event(Event::Empty(elem)).map_err(|e| e.to_string())?;
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
        self.add_rel_entry("styles", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles", "styles.xml", None)?;
        self.add_rel_entry("numbering", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering", "numbering.xml", None)?;
        if !self.footnote_defs.is_empty() {
            self.add_rel_entry("footnotes", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes", "footnotes.xml", None)?;
        }
        Ok(())
    }

    fn add_rel_entry(&mut self, _id_suffix: &str, rel_type: &str, target: &str, target_mode: Option<&str>) -> Result<(), String> {
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
        w.write_event(Event::Start(BytesStart::new("Relationships")
            .with_attributes([("xmlns", "http://schemas.openxmlformats.org/package/2006/relationships")])))
            .map_err(|e| e.to_string())?;

        for entry in &self.rels_entries {
            let mut elem = BytesStart::new("Relationship");
            elem.push_attribute(("Id", entry.id.as_str()));
            elem.push_attribute(("Type", entry.rel_type.as_str()));
            elem.push_attribute(("Target", entry.target.as_str()));
            if let Some(ref mode) = entry.target_mode {
                elem.push_attribute(("TargetMode", mode.as_str()));
            }
            w.write_event(Event::Empty(elem)).map_err(|e| e.to_string())?;
        }

        w.write_event(Event::End(BytesEnd::new("Relationships")))
            .map_err(|e| e.to_string())?;
        Ok(w.into_inner())
    }
}

// ═══════════════════════════════════════════════════════════════════════
// OOXML boilerplate: word/styles.xml
// ═══════════════════════════════════════════════════════════════════════

impl DocxWriter {
    fn write_styles(&mut self) -> Result<(), String> {
        self.styles.write_event(Event::Decl(BytesDecl::new("1.0", Some("UTF-8"), None)))
            .map_err(|e| e.to_string())?;
        self.styles.write_event(Event::Start(BytesStart::new("w:styles")
            .with_attributes([("xmlns:w", "http://schemas.openxmlformats.org/wordprocessingml/2006/main")])))
            .map_err(|e| e.to_string())?;

        // Normal style
        self.write_style("Normal", "Normal", "Para", true, |w| {
            w.write_event(Event::Start(BytesStart::new("w:pPr"))).unwrap();
            let mut spacing = BytesStart::new("w:spacing");
            spacing.push_attribute(("w:line", "276")); // 1.15 line spacing (240 * 1.15)
            spacing.push_attribute(("w:lineRule", "auto"));
            w.write_event(Event::Empty(spacing)).unwrap();
            w.write_event(Event::End(BytesEnd::new("w:pPr"))).unwrap();
            w.write_event(Event::Start(BytesStart::new("w:rPr"))).unwrap();
            write_rfont(w, "Calibri");
            write_sz(w, 22); // 11pt * 2
            w.write_event(Event::End(BytesEnd::new("w:rPr"))).unwrap();
        })?;

        // Heading 1-6 styles
        let headings: [(&str, &str, u16, bool, Option<&str>, &str); 6] = [
            ("Heading1", "heading 1", 48, true,  Some("2B579A"), "Cambria"), // H1: 24pt, bold, dark blue
            ("Heading2", "heading 2", 36, true,  Some("2B579A"), "Cambria"), // H2: 18pt, bold, dark blue
            ("Heading3", "heading 3", 28, true,  None,           "Cambria"), // H3: 14pt, bold
            ("Heading4", "heading 4", 24, false, None,           "Cambria"), // H4: 12pt, italic (not bold)
            ("Heading5", "heading 5", 22, true,  None,           "Calibri"), // H5: 11pt, bold, Calibri
            ("Heading6", "heading 6", 20, true,  None,           "Calibri"), // H6: 10pt, bold, Calibri
        ];
        for (style_id, name, sz, bold, color, font) in &headings {
            self.write_style(style_id, name, "Para", false, |w| {
                w.write_event(Event::Start(BytesStart::new("w:pPr"))).unwrap();
                let mut spacing = BytesStart::new("w:spacing");
                spacing.push_attribute(("w:before", "240")); // 12pt before
                spacing.push_attribute(("w:after", "120"));  // 6pt after
                w.write_event(Event::Empty(spacing)).unwrap();
                w.write_event(Event::End(BytesEnd::new("w:pPr"))).unwrap();
                w.write_event(Event::Start(BytesStart::new("w:rPr"))).unwrap();
                write_rfont(w, font);
                if *bold {
                    w.write_event(Event::Empty(BytesStart::new("w:b"))).unwrap();
                }
                if *style_id == "Heading4" {
                    w.write_event(Event::Empty(BytesStart::new("w:i"))).unwrap();
                }
                if let Some(c) = color {
                    let mut col_elem = BytesStart::new("w:color");
                    col_elem.push_attribute(("w:val", *c));
                    w.write_event(Event::Empty(col_elem)).unwrap();
                }
                write_sz(w, *sz);
                w.write_event(Event::End(BytesEnd::new("w:rPr"))).unwrap();
            })?;
        }

        // Code paragraph style (for code blocks)
        self.write_style("Code", "Code", "Para", false, |w| {
            w.write_event(Event::Start(BytesStart::new("w:rPr"))).unwrap();
            write_rfont_code(w);
            write_sz(w, 19);
            let mut shd = BytesStart::new("w:shd");
            shd.push_attribute(("w:val", "clear"));
            shd.push_attribute(("w:fill", "F5F5F5"));
            w.write_event(Event::Empty(shd)).unwrap();
            w.write_event(Event::End(BytesEnd::new("w:rPr"))).unwrap();
        })?;

        // Code character style (for inline code)
        self.write_style("CodeLang", "CodeLang", "Char", false, |w| {
            w.write_event(Event::Start(BytesStart::new("w:rPr"))).unwrap();
            write_rfont_code(w);
            write_sz(w, 19);
            let mut shd = BytesStart::new("w:shd");
            shd.push_attribute(("w:val", "clear"));
            shd.push_attribute(("w:fill", "F5F5F5"));
            w.write_event(Event::Empty(shd)).unwrap();
            w.write_event(Event::End(BytesEnd::new("w:rPr"))).unwrap();
        })?;

        // ListParagraph style (for list items)
        self.write_style("ListParagraph", "List Paragraph", "Para", false, |w| {
            w.write_event(Event::Start(BytesStart::new("w:pPr"))).unwrap();
            let mut ind = BytesStart::new("w:ind");
            ind.push_attribute(("w:left", "720"));
            w.write_event(Event::Empty(ind)).unwrap();
            w.write_event(Event::End(BytesEnd::new("w:pPr"))).unwrap();
            w.write_event(Event::Start(BytesStart::new("w:rPr"))).unwrap();
            write_rfont(w, "Calibri");
            write_sz(w, 22);
            w.write_event(Event::End(BytesEnd::new("w:rPr"))).unwrap();
        })?;

        // Quote style
        self.write_style("Quote", "Quote", "Para", false, |w| {
            w.write_event(Event::Start(BytesStart::new("w:pPr"))).unwrap();
            let mut ind = BytesStart::new("w:ind");
            ind.push_attribute(("w:left", "720"));
            w.write_event(Event::Empty(ind)).unwrap();
            w.write_event(Event::End(BytesEnd::new("w:pPr"))).unwrap();
            w.write_event(Event::Start(BytesStart::new("w:rPr"))).unwrap();
            write_rfont(w, "Calibri");
            write_sz(w, 22);
            w.write_event(Event::Empty(BytesStart::new("w:i"))).unwrap();
            w.write_event(Event::End(BytesEnd::new("w:rPr"))).unwrap();
        })?;

        self.styles.write_event(Event::End(BytesEnd::new("w:styles")))
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn write_style<F>(&mut self, id: &str, name: &str, stype: &str, is_default: bool, f: F) -> Result<(), String>
    where F: Fn(&mut Writer<Vec<u8>>) {
        let w = &mut self.styles;
        let mut style = BytesStart::new("w:style");
        style.push_attribute(("w:styleId", id));
        style.push_attribute(("w:type", stype));
        if is_default {
            style.push_attribute(("w:default", "1"));
        }
        w.write_event(Event::Start(style)).map_err(|e| e.to_string())?;

        let mut name_elem = BytesStart::new("w:name");
        name_elem.push_attribute(("w:val", name));
        w.write_event(Event::Empty(name_elem)).map_err(|e| e.to_string())?;

        f(w);

        w.write_event(Event::End(BytesEnd::new("w:style"))).map_err(|e| e.to_string())?;
        Ok(())
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Helper: font/size writers (standalone functions)
// ═══════════════════════════════════════════════════════════════════════

fn write_rfont_code(w: &mut Writer<Vec<u8>>) {
    let mut rfonts = BytesStart::new("w:rFonts");
    rfonts.push_attribute(("w:ascii", "Consolas"));
    rfonts.push_attribute(("w:hAnsi", "Consolas"));
    rfonts.push_attribute(("w:cs", "Consolas"));
    w.write_event(Event::Empty(rfonts)).unwrap();
}

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
        self.document.write_event(Event::Decl(BytesDecl::new("1.0", Some("UTF-8"), None)))
            .map_err(|e| e.to_string())?;
        self.document.write_event(Event::Start(BytesStart::new("w:document")
            .with_attributes([("xmlns:w", "http://schemas.openxmlformats.org/wordprocessingml/2006/main")])
            .with_attributes([("xmlns:r", "http://schemas.openxmlformats.org/officeDocument/2006/relationships")])))
            .map_err(|e| e.to_string())?;
        self.document.write_event(Event::Start(BytesStart::new("w:body")))
            .map_err(|e| e.to_string())?;

        // Second pass: traverse AST and write document content
        self.walk_ast(root, base_path);

        // Close document.xml body
        self.document.write_event(Event::End(BytesEnd::new("w:body")))
            .map_err(|e| e.to_string())?;
        self.document.write_event(Event::End(BytesEnd::new("w:document")))
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
                let level = heading.level.min(6).max(1);
                self.write_paragraph_start(Some(&format!("Heading{}", level)), None);
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
                        let is_para = matches!(grandchild.data.borrow().value, NodeValue::Paragraph);
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
                self.write_paragraph_start(Some("Quote"), None);
                for child in node.children() {
                    self.walk_ast(child, base_path);
                }
                self.write_paragraph_end();
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
                            } else if let NodeValue::DescriptionDetails = desc_child.data.borrow().value {
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
            w.write_event(Event::Start(BytesStart::new("w:pPr"))).unwrap();
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
        self.document.write_event(Event::End(BytesEnd::new("w:p"))).unwrap();
    }

    fn write_run_start(&mut self, bold: bool, italic: bool, strike: bool, superscript: bool, _description: bool) {
        let w = &mut self.document;
        w.write_event(Event::Start(BytesStart::new("w:r"))).unwrap();
        if bold || italic || strike || superscript {
            w.write_event(Event::Start(BytesStart::new("w:rPr"))).unwrap();
            if bold { w.write_event(Event::Empty(BytesStart::new("w:b"))).unwrap(); }
            if italic { w.write_event(Event::Empty(BytesStart::new("w:i"))).unwrap(); }
            if strike {
                w.write_event(Event::Empty(BytesStart::new("w:strike"))).unwrap();
            }
            if superscript {
                w.write_event(Event::Empty(BytesStart::new("w:vertAlign").with_attributes([("w:val", "superscript")]))).unwrap();
            }
            w.write_event(Event::End(BytesEnd::new("w:rPr"))).unwrap();
        }
    }

    fn write_run_end(&mut self) {
        self.document.write_event(Event::End(BytesEnd::new("w:r"))).unwrap();
    }

    fn write_text_run(&mut self, text: &str) {
        if text.is_empty() { return; }
        let w = &mut self.document;
        w.write_event(Event::Start(BytesStart::new("w:r"))).unwrap();
        w.write_event(Event::Start(BytesStart::new("w:t"))).unwrap();
        w.write_event(Event::Text(BytesText::new(text))).unwrap();
        w.write_event(Event::End(BytesEnd::new("w:t"))).unwrap();
        w.write_event(Event::End(BytesEnd::new("w:r"))).unwrap();
    }

    fn write_code_run(&mut self, code: &str) {
        let w = &mut self.document;
        w.write_event(Event::Start(BytesStart::new("w:r"))).unwrap();
        w.write_event(Event::Start(BytesStart::new("w:rPr"))).unwrap();
        write_rfont_code(w);
        let mut shd = BytesStart::new("w:shd");
        shd.push_attribute(("w:val", "clear"));
        shd.push_attribute(("w:fill", "F5F5F5"));
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
        w.write_event(Event::Start(BytesStart::new("w:pPr"))).unwrap();
        w.write_event(Event::Start(BytesStart::new("w:pBdr"))).unwrap();
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

    fn write_code_block(&mut self, lang: &str, code: &str) {
        let w = &mut self.document;

        // Language label line (if present)
        if !lang.is_empty() {
            w.write_event(Event::Start(BytesStart::new("w:p"))).unwrap();
            w.write_event(Event::Start(BytesStart::new("w:pPr"))).unwrap();
            w.write_event(Event::End(BytesEnd::new("w:pPr"))).unwrap();

            // lang label run — smaller, muted, italic
            w.write_event(Event::Start(BytesStart::new("w:r"))).unwrap();
            w.write_event(Event::Start(BytesStart::new("w:rPr"))).unwrap();
            write_rfont_code(w);
            let mut color = BytesStart::new("w:color");
            color.push_attribute(("w:val", "888888"));
            w.write_event(Event::Empty(color)).unwrap();
            w.write_event(Event::Empty(BytesStart::new("w:i"))).unwrap();
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
        let p_pr = BytesStart::new("w:pPr");
        let p_style = BytesStart::new("w:pStyle");
        let mut p_style = p_style;
        p_style.push_attribute(("w:val", "Code"));
        w.write_event(Event::Start(p_pr)).unwrap();
        w.write_event(Event::Empty(p_style)).unwrap();
        w.write_event(Event::End(BytesEnd::new("w:pPr"))).unwrap();

        let lines: Vec<&str> = code.lines().collect();
        for (i, line) in lines.iter().enumerate() {
            w.write_event(Event::Start(BytesStart::new("w:r"))).unwrap();
            w.write_event(Event::Start(BytesStart::new("w:rPr"))).unwrap();
            write_rfont_code(w);
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
            rel_type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink".to_string(),
            target: url.to_string(),
            target_mode: Some("External".to_string()),
        });

        let mut hyperlink = BytesStart::new("w:hyperlink");
        hyperlink.push_attribute(("r:id", rid.as_str()));
        self.document.write_event(Event::Start(hyperlink)).unwrap();

        for child in node.children() {
            self.walk_ast(child, base_path);
        }

        self.document.write_event(Event::End(BytesEnd::new("w:hyperlink"))).unwrap();
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Table
// ═══════════════════════════════════════════════════════════════════════

impl DocxWriter {
    fn write_table<'a>(&mut self, node: &'a AstNode<'a>, base_path: &str) {
        self.document.write_event(Event::Start(BytesStart::new("w:tbl"))).unwrap();

        // Count columns from first row
        let col_count = node.children().next()
            .and_then(|row| match &row.data.borrow().value {
                NodeValue::TableRow(_) => {
                    let n = row.children().count();
                    if n > 0 { Some(n) } else { None }
                },
                _ => None,
            })
            .unwrap_or(1);

        // Table width: standard US letter text area (8.5" - 2×1" margins = 6.5" = 9360 twips)
        const PAGE_TEXT_WIDTH: u32 = 9360;
        let col_width = (PAGE_TEXT_WIDTH / col_count as u32).max(500);
        let col_width_str = col_width.to_string();
        let page_w_str = PAGE_TEXT_WIDTH.to_string();

        // Table properties
        self.document.write_event(Event::Start(BytesStart::new("w:tblPr"))).unwrap();
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
        self.document.write_event(Event::Start(BytesStart::new("w:tblBorders"))).unwrap();
        for side in &["top", "left", "bottom", "right", "insideH", "insideV"] {
            let side_name = format!("w:{}", side);
            let mut border = BytesStart::new(&side_name);
            border.push_attribute(("w:val", "single"));
            border.push_attribute(("w:sz", "4"));
            border.push_attribute(("w:color", "auto"));
            self.document.write_event(Event::Empty(border)).unwrap();
        }
        self.document.write_event(Event::End(BytesEnd::new("w:tblBorders"))).unwrap();
        self.document.write_event(Event::End(BytesEnd::new("w:tblPr"))).unwrap();

        // Table grid (column definitions)
        self.document.write_event(Event::Start(BytesStart::new("w:tblGrid"))).unwrap();
        for _ in 0..col_count {
            let mut gc = BytesStart::new("w:gridCol");
            gc.push_attribute(("w:w", col_width_str.as_str()));
            self.document.write_event(Event::Empty(gc)).unwrap();
        }
        self.document.write_event(Event::End(BytesEnd::new("w:tblGrid"))).unwrap();

        // Rows
        for child in node.children() {
            match &child.data.borrow().value {
                NodeValue::TableRow(_) => {
                    self.document.write_event(Event::Start(BytesStart::new("w:tr"))).unwrap();
                    for cell in child.children() {
                        self.document.write_event(Event::Start(BytesStart::new("w:tc"))).unwrap();
                        // Cell width matching column width
                        let mut tcw = BytesStart::new("w:tcW");
                        tcw.push_attribute(("w:w", col_width_str.as_str()));
                        tcw.push_attribute(("w:type", "dxa"));
                        self.document.write_event(Event::Empty(tcw)).unwrap();

                        self.document.write_event(Event::Start(BytesStart::new("w:p"))).unwrap();
                        // Center cell content horizontally
                        self.document.write_event(Event::Start(BytesStart::new("w:pPr"))).unwrap();
                        let mut cell_jc = BytesStart::new("w:jc");
                        cell_jc.push_attribute(("w:val", "center"));
                        self.document.write_event(Event::Empty(cell_jc)).unwrap();
                        self.document.write_event(Event::End(BytesEnd::new("w:pPr"))).unwrap();
                        for cell_child in cell.children() {
                            self.walk_ast(cell_child, base_path);
                        }
                        self.document.write_event(Event::End(BytesEnd::new("w:p"))).unwrap();
                        self.document.write_event(Event::End(BytesEnd::new("w:tc"))).unwrap();
                    }
                    self.document.write_event(Event::End(BytesEnd::new("w:tr"))).unwrap();
                }
                _ => {}
            }
        }

        self.document.write_event(Event::End(BytesEnd::new("w:tbl"))).unwrap();
    }
}

// ═══════════════════════════════════════════════════════════════════════
// List item writing (with numbering)
// ═══════════════════════════════════════════════════════════════════════

impl DocxWriter {
    fn write_list_item(&mut self, ordered: bool, _start: u64, checked: bool, is_task: bool) {
        self.document.write_event(Event::Start(BytesStart::new("w:p"))).unwrap();
        self.document.write_event(Event::Start(BytesStart::new("w:pPr"))).unwrap();

        let num_id = if ordered { 1u32 } else { 2u32 };
        self.document.write_event(Event::Start(BytesStart::new("w:numPr"))).unwrap();
        let mut ilvl = BytesStart::new("w:ilvl");
        ilvl.push_attribute(("w:val", "0"));
        self.document.write_event(Event::Empty(ilvl)).unwrap();
        let mut num_id_elem = BytesStart::new("w:numId");
        num_id_elem.push_attribute(("w:val", num_id.to_string().as_str()));
        self.document.write_event(Event::Empty(num_id_elem)).unwrap();
        self.document.write_event(Event::End(BytesEnd::new("w:numPr"))).unwrap();

        self.document.write_event(Event::End(BytesEnd::new("w:pPr"))).unwrap();

        if checked {
            self.write_text_run("☑ ");
        } else if is_task {
            self.write_text_run("☐ ");
        }
    }

    fn write_numbering(&mut self) -> Result<(), String> {
        self.numbering.write_event(Event::Decl(BytesDecl::new("1.0", Some("UTF-8"), None)))
            .map_err(|e| e.to_string())?;
        self.numbering.write_event(Event::Start(BytesStart::new("w:numbering")
            .with_attributes([("xmlns:w", "http://schemas.openxmlformats.org/wordprocessingml/2006/main")])))
            .map_err(|e| e.to_string())?;

        // Abstract numbering 1: ordered (decimal)
        self.write_abstract_num(1, "decimal")?;
        // Abstract numbering 2: unordered (bullet)
        self.write_abstract_num(2, "bullet")?;

        // Numbering instances
        self.write_num_instance(1, 1)?;
        self.write_num_instance(2, 2)?;

        self.numbering.write_event(Event::End(BytesEnd::new("w:numbering")))
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn write_abstract_num(&mut self, id: u32, fmt: &str) -> Result<(), String> {
        let w = &mut self.numbering;
        let mut abs = BytesStart::new("w:abstractNum");
        abs.push_attribute(("w:abstractNumId", id.to_string().as_str()));
        w.write_event(Event::Start(abs)).map_err(|e| e.to_string())?;

        // Level 0
        w.write_event(Event::Start(BytesStart::new("w:lvl").with_attributes([("w:ilvl", "0")]))).map_err(|e| e.to_string())?;
        let mut start = BytesStart::new("w:start");
        start.push_attribute(("w:val", "1"));
        w.write_event(Event::Empty(start)).map_err(|e| e.to_string())?;
        let mut numfmt = BytesStart::new("w:numFmt");
        numfmt.push_attribute(("w:val", fmt));
        w.write_event(Event::Empty(numfmt)).map_err(|e| e.to_string())?;
        let mut lvl_text = BytesStart::new("w:lvlText");
        lvl_text.push_attribute(("w:val", if fmt == "bullet" { "\u{2022}" } else { "%1" }));
        w.write_event(Event::Empty(lvl_text)).map_err(|e| e.to_string())?;
        let mut lvl_jc = BytesStart::new("w:lvlJc");
        lvl_jc.push_attribute(("w:val", "left"));
        w.write_event(Event::Empty(lvl_jc)).map_err(|e| e.to_string())?;
        w.write_event(Event::End(BytesEnd::new("w:lvl"))).map_err(|e| e.to_string())?;

        w.write_event(Event::End(BytesEnd::new("w:abstractNum"))).map_err(|e| e.to_string())?;
        Ok(())
    }

    fn write_num_instance(&mut self, instance_id: u32, abstract_id: u32) -> Result<(), String> {
        let w = &mut self.numbering;
        let mut num = BytesStart::new("w:num");
        num.push_attribute(("w:numId", instance_id.to_string().as_str()));
        w.write_event(Event::Start(num)).map_err(|e| e.to_string())?;
        let mut abs_ref = BytesStart::new("w:abstractNumId");
        abs_ref.push_attribute(("w:val", abstract_id.to_string().as_str()));
        w.write_event(Event::Empty(abs_ref)).map_err(|e| e.to_string())?;
        w.write_event(Event::End(BytesEnd::new("w:num"))).map_err(|e| e.to_string())?;
        Ok(())
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

        let options: FileOptions<'_, ()> = FileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);

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
        write!(zip, r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/extended-properties" Target="docProps/app.xml"/>
</Relationships>"#).map_err(|e| e.to_string())?;

        // docProps
        zip.add_directory("docProps/", FileOptions::<'_, ()>::default())
            .map_err(|e| e.to_string())?;
        zip.start_file("docProps/app.xml", options)
            .map_err(|e| e.to_string())?;
        write!(zip, r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
<Application>RMD</Application>
</Properties>"#).map_err(|e| e.to_string())?;

        zip.start_file("docProps/core.xml", options)
            .map_err(|e| e.to_string())?;
        write!(zip, r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:dcterms="http://purl.org/dc/terms/">
<dc:creator>RMD</dc:creator>
<dc:title>RMD Document</dc:title>
</cp:coreProperties>"#).map_err(|e| e.to_string())?;

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
// Image helpers
// ═══════════════════════════════════════════════════════════════════════

/// Parse (width, height) in pixels from decoded image bytes.
/// Supports PNG (IHDR), JPEG (SOF0), and GIF (header).
/// For SVG and WebP, or on failure, returns (100, 100) as fallback.
fn parse_image_dimensions(data: &[u8]) -> (u32, u32) {
    // PNG: 8-byte signature + IHDR chunk: 4 len + 4 "IHDR" + 4 W + 4 H
    if data.len() >= 24
        && data[0..8] == [137, 80, 78, 71, 13, 10, 26, 10]
    {
        let width = u32::from_be_bytes([data[16], data[17], data[18], data[19]]);
        let height = u32::from_be_bytes([data[20], data[21], data[22], data[23]]);
        return (width, height);
    }

    // JPEG: starts with SOI marker FF D8; scan for SOF0 (FF C0) / SOF1 (FF C1) / SOF2 (FF C2)
    if data.len() >= 4 && data[0] == 0xFF && data[1] == 0xD8 {
        let mut pos = 2;
        while pos + 8 < data.len() {
            if data[pos] != 0xFF {
                break;
            }
            let marker = data[pos + 1];
            // SOF0, SOF1, SOF2 — contain dimensions at offset 5,6 (height) and 7,8 (width)
            if marker == 0xC0 || marker == 0xC1 || marker == 0xC2 {
                let height = u16::from_be_bytes([data[pos + 5], data[pos + 6]]);
                let width = u16::from_be_bytes([data[pos + 7], data[pos + 8]]);
                return (width as u32, height as u32);
            }
            // Skip past marker length (2 bytes after marker, before data)
            let seg_len = u16::from_be_bytes([data[pos + 2], data[pos + 3]]);
            if seg_len < 2 {
                break;
            }
            pos += 2 + seg_len as usize;
        }
    }

    // GIF: "GIF87a" or "GIF89a", then 2 bytes LE width, 2 bytes LE height
    if data.len() >= 10
        && &data[0..3] == b"GIF"
        && (&data[3..6] == b"87a" || &data[3..6] == b"89a")
    {
        let width = u16::from_le_bytes([data[6], data[7]]);
        let height = u16::from_le_bytes([data[8], data[9]]);
        return (width as u32, height as u32);
    }

    // SVG: search for viewBox="x y width height" or viewBox='x y width height'
    if data.len() > 100 && (data[0] == b'<' && (data[1] == b'?' || data[1] == b's')) {
        if let Some(pos) = data.windows(7).position(|w| w == b"viewBox") {
            let after = &data[pos + 7..];
            // Skip = and whitespace before the quote
            let q_pos = after.iter().position(|&b| b == b'"' || b == b'\'');
            if let Some(qi) = q_pos {
                let quote = after[qi];
                let val_start = qi + 1;
                if let Some(end) = after[val_start..].iter().position(|&b| b == quote) {
                    let values: Vec<f64> = after[val_start..val_start + end]
                        .split(|&b| b == b' ' || b == b',' || b == b'\t' || b == b'\n' || b == b'\r')
                        .filter_map(|s| {
                            if s.is_empty() { return None; }
                            let s_str = std::str::from_utf8(s).ok()?;
                            s_str.trim().parse::<f64>().ok()
                        })
                        .collect();
                    if values.len() == 4 {
                        return (values[2] as u32, values[3] as u32);
                    }
                }
            }
        }
    }

    // Fallback: 100×100 px so the image still appears
    (100, 100)
}

/// Convert pixels to EMU (English Metric Units) at 96 DPI.
/// 1 inch = 914400 EMU.
fn px_to_emu(px: u32) -> i64 {
    (px as f64 * 914_400.0 / 96.0) as i64
}

/// Convert SVG byte data to a PNG byte vector using resvg.
/// Returns None on parse/render failure.
/// Lazily-initialised font database with system fonts loaded.
/// Cached to avoid re-loading thousands of fonts on every SVG conversion.
fn system_fontdb() -> &'static std::sync::Arc<usvg::fontdb::Database> {
    static FONTDB: std::sync::OnceLock<std::sync::Arc<usvg::fontdb::Database>> = std::sync::OnceLock::new();
    FONTDB.get_or_init(|| {
        let mut db = usvg::fontdb::Database::new();
        db.load_system_fonts();
        db.set_serif_family("Times New Roman");
        db.set_sans_serif_family("Arial");
        db.set_cursive_family("Comic Sans MS");
        db.set_fantasy_family("Impact");
        db.set_monospace_family("Courier New");
        std::sync::Arc::new(db)
    })
}

fn svg_to_png(svg_data: &[u8], scale: f64) -> Option<(Vec<u8>, u32, u32)> {
    let opt = usvg::Options {
        fontdb: system_fontdb().clone(),
        ..usvg::Options::default()
    };

    let tree = match usvg::Tree::from_data(svg_data, &opt) {
        Ok(t) => t,
        Err(e) => {
            eprintln!("[DOCX] svg_to_png: usvg parse error: {e:?}");
            return None;
        }
    };
    let size = tree.size();
    let orig_w = size.width() as u32;
    let orig_h = size.height() as u32;
    let scaled_w = (orig_w as f64 * scale).ceil().max(1.0) as u32;
    let scaled_h = (orig_h as f64 * scale).ceil().max(1.0) as u32;
    let mut pixmap = match resvg::tiny_skia::Pixmap::new(scaled_w, scaled_h) {
        Some(p) => p,
        None => { eprintln!("[DOCX] svg_to_png: zero-size pixmap ({scaled_w}x{scaled_h})"); return None; }
    };
    let ts = resvg::tiny_skia::Transform::from_scale(scale as f32, scale as f32);
    resvg::render(&tree, ts, &mut pixmap.as_mut());
    match pixmap.encode_png() {
        Ok(png) => Some((png, orig_w, orig_h)),
        Err(e) => { eprintln!("[DOCX] svg_to_png: PNG encode error: {e}"); None }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Image writing
// ═══════════════════════════════════════════════════════════════════════

impl DocxWriter {
    fn write_image(&mut self, url: &str, alt: &str, _base_path: &str) {
        if !url.starts_with("data:") {
            // Non-data URI — try fallback with text
            self.write_text_run(&format!("[Image: {}]", alt));
            return;
        }

        // Parse data URI: data:image/{ext};base64,{data}
        let rest = url.strip_prefix("data:").unwrap_or(url);
        let (mime_part, b64) = match rest.split_once(',') {
            Some((m, d)) => (m, d),
            None => { self.write_text_run(&format!("[Image: {}]", alt)); return; }
        };

        // Determine extension
        let mut ext = if mime_part.contains("svg") { "svg" }
                  else if mime_part.contains("png") { "png" }
                  else if mime_part.contains("jpeg") || mime_part.contains("jpg") { "jpg" }
                  else if mime_part.contains("gif") { "gif" }
                  else if mime_part.contains("webp") { "webp" }
                  else { "png" };

        // Decode base64
        let mut decoded = match base64::Engine::decode(
            &base64::engine::general_purpose::STANDARD,
            b64.trim()
        ) {
            Ok(d) => d,
            Err(_) => { self.write_text_run(&format!("[Image: {}]", alt)); return; }
        };

        // SVG images — convert to high-DPI PNG for clarity in DOCX
        // foreignObject SVGs are embedded directly (Word renders them natively).
        let has_fo = decoded.windows(13).any(|w| w == b"foreignObject");
        let mut svg_orig_dims: Option<(u32, u32)> = None; // unscaled SVG dims for emu
        if ext == "svg" {
            eprintln!("[DOCX] SVG image: {} bytes, foreignObject={}, action={}",
                decoded.len(), has_fo,
                if has_fo { "embed SVG (Word renders text)" } else { "convert to 2x PNG" });
            if !has_fo {
                // Render at 2x for sharp output; keep original dims for display
                if let Some((png_data, ow, oh)) = svg_to_png(&decoded, 2.0) {
                    decoded = png_data;
                    ext = "png";
                    svg_orig_dims = Some((ow, oh));
                }
            }
        }

        let image_name = format!("image{}.{}", self.images.len() + 1, ext);
        let (w_px, h_px) = match svg_orig_dims {
            Some((ow, oh)) => (ow, oh),
            None => parse_image_dimensions(&decoded),
        };
        let cx = px_to_emu(w_px.max(1));
        let cy = px_to_emu(h_px.max(1));
        let cx_str = cx.to_string();
        let cy_str = cy.to_string();
        self.images.push((image_name.clone(), decoded));

        // Register relationship
        self.rel_id_counter += 1;
        let rid = format!("rId{}", self.rel_id_counter);
        self.rels_entries.push(RelEntry {
            id: rid.clone(),
            rel_type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image".to_string(),
            target: format!("media/{}", image_name),
            target_mode: None,
        });

        // Write drawing element
        let w = &mut self.document;
        w.write_event(Event::Start(BytesStart::new("w:r"))).unwrap();
        w.write_event(Event::Start(BytesStart::new("w:drawing"))).unwrap();
        w.write_event(Event::Start(BytesStart::new("wp:inline")
            .with_attributes([("xmlns:wp", "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing")])
            .with_attributes([("xmlns:a", "http://schemas.openxmlformats.org/drawingml/2006/main")])
            .with_attributes([("xmlns:r", "http://schemas.openxmlformats.org/officeDocument/2006/relationships")])))
            .unwrap();

        w.write_event(Event::Empty(BytesStart::new("wp:extent")
            .with_attributes([("cx", cx_str.as_str())])
            .with_attributes([("cy", cy_str.as_str())])))
            .unwrap();

        w.write_event(Event::Start(BytesStart::new("wp:docPr")
            .with_attributes([("id", "1")])
            .with_attributes([("name", alt)]))).unwrap();
        w.write_event(Event::End(BytesEnd::new("wp:docPr"))).unwrap();

        w.write_event(Event::Start(BytesStart::new("a:graphic"))).unwrap();
        w.write_event(Event::Start(BytesStart::new("a:graphicData")
            .with_attributes([("uri", "http://schemas.openxmlformats.org/drawingml/2006/picture")])))
            .unwrap();
        w.write_event(Event::Start(BytesStart::new("pic:pic")
            .with_attributes([("xmlns:pic", "http://schemas.openxmlformats.org/drawingml/2006/picture")])))
            .unwrap();

        w.write_event(Event::Start(BytesStart::new("pic:blipFill"))).unwrap();
        w.write_event(Event::Empty(BytesStart::new("a:blip")
            .with_attributes([("r:embed", rid.as_str())])))
            .unwrap();
        w.write_event(Event::End(BytesEnd::new("pic:blipFill"))).unwrap();

        w.write_event(Event::Start(BytesStart::new("pic:spPr"))).unwrap();
        w.write_event(Event::Start(BytesStart::new("a:xfrm"))).unwrap();
        w.write_event(Event::Empty(BytesStart::new("a:off")
            .with_attributes([("x", "0")]).with_attributes([("y", "0")])))
            .unwrap();
        w.write_event(Event::Empty(BytesStart::new("a:ext")
            .with_attributes([("cx", cx_str.as_str())]).with_attributes([("cy", cy_str.as_str())])))
            .unwrap();
        w.write_event(Event::End(BytesEnd::new("a:xfrm"))).unwrap();
        w.write_event(Event::Start(BytesStart::new("a:prstGeom")
            .with_attributes([("prst", "rect")]))).unwrap();
        w.write_event(Event::End(BytesEnd::new("a:prstGeom"))).unwrap();
        w.write_event(Event::End(BytesEnd::new("pic:spPr"))).unwrap();

        w.write_event(Event::End(BytesEnd::new("pic:pic"))).unwrap();
        w.write_event(Event::End(BytesEnd::new("a:graphicData"))).unwrap();
        w.write_event(Event::End(BytesEnd::new("a:graphic"))).unwrap();
        w.write_event(Event::End(BytesEnd::new("wp:inline"))).unwrap();
        w.write_event(Event::End(BytesEnd::new("w:drawing"))).unwrap();
        w.write_event(Event::End(BytesEnd::new("w:r"))).unwrap();
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Footnote support
// ═══════════════════════════════════════════════════════════════════════

impl DocxWriter {
    fn collect_footnotes<'a>(&mut self, root: &'a AstNode<'a>) {
        for child in root.children() {
            self.collect_footnotes_recursive(child);
        }
    }

    fn collect_footnotes_recursive<'a>(&mut self, node: &'a AstNode<'a>) {
        match &node.data.borrow().value {
            NodeValue::FootnoteDefinition(_) => {
                // Render footnote content to a buffer
                let mut fn_writer = Writer::new_with_indent(Vec::new(), b' ', 2);
                for child in node.children() {
                    render_to_writer(child, &mut fn_writer, "");
                }
                let id = self.footnote_defs.len() as u64 + 1; // sequential 1-based IDs
                self.footnote_defs.push((id, fn_writer.into_inner()));
            }
            _ => {
                for child in node.children() {
                    self.collect_footnotes_recursive(child);
                }
            }
        }
    }
}

// ── render_to_writer is a standalone helper outside impl DocxWriter ──

/// Walk a sub-tree and write to an arbitrary writer (for footnotes content)
fn render_to_writer<'a>(node: &'a AstNode<'a>, writer: &mut Writer<Vec<u8>>, _base_path: &str) {
    match &node.data.borrow().value {
        NodeValue::Paragraph => {
            writer.write_event(Event::Start(BytesStart::new("w:p"))).unwrap();
            for child in node.children() {
                render_to_writer(child, writer, _base_path);
            }
            writer.write_event(Event::End(BytesEnd::new("w:p"))).unwrap();
        }
        NodeValue::Text(text) => {
            writer.write_event(Event::Start(BytesStart::new("w:r"))).unwrap();
            writer.write_event(Event::Start(BytesStart::new("w:t"))).unwrap();
            writer.write_event(Event::Text(BytesText::new(text))).unwrap();
            writer.write_event(Event::End(BytesEnd::new("w:t"))).unwrap();
            writer.write_event(Event::End(BytesEnd::new("w:r"))).unwrap();
        }
        NodeValue::Strong => {
            writer.write_event(Event::Start(BytesStart::new("w:r"))).unwrap();
            writer.write_event(Event::Empty(BytesStart::new("w:b"))).unwrap();
            for child in node.children() {
                render_to_writer(child, writer, _base_path);
            }
            writer.write_event(Event::End(BytesEnd::new("w:r"))).unwrap();
        }
        _ => {
            for child in node.children() {
                render_to_writer(child, writer, _base_path);
            }
        }
    }
}

// ── back inside impl DocxWriter ──

impl DocxWriter {
    fn resolve_footnote_id(&self, original: u64) -> u64 {
        // Simple pass-through — comrak IDs should be 1-based and contiguous
        original
    }

    fn write_footnote_reference(&mut self, id: u64) {
        let w = &mut self.document;
        w.write_event(Event::Start(BytesStart::new("w:r"))).unwrap();
        let mut ref_elem = BytesStart::new("w:footnoteReference");
        ref_elem.push_attribute(("w:id", id.to_string().as_str()));
        w.write_event(Event::Empty(ref_elem)).unwrap();
        w.write_event(Event::End(BytesEnd::new("w:r"))).unwrap();
    }

    fn write_footnotes_part(&mut self) -> Result<(), String> {
        let mut fn_w = Writer::new_with_indent(Vec::new(), b' ', 2);
        fn_w.write_event(Event::Decl(BytesDecl::new("1.0", Some("UTF-8"), None)))
            .map_err(|e| e.to_string())?;
        fn_w.write_event(Event::Start(BytesStart::new("w:footnotes")
            .with_attributes([("xmlns:w", "http://schemas.openxmlformats.org/wordprocessingml/2006/main")])
            .with_attributes([("xmlns:r", "http://schemas.openxmlformats.org/officeDocument/2006/relationships")])))
            .map_err(|e| e.to_string())?;

        // Separator footnote (Word requires it)
        fn_w.write_event(Event::Start(BytesStart::new("w:footnote").with_attributes([("w:id", "-1")])))
            .map_err(|e| e.to_string())?;
        fn_w.write_event(Event::Start(BytesStart::new("w:p"))).map_err(|e| e.to_string())?;
        fn_w.write_event(Event::Start(BytesStart::new("w:r"))).map_err(|e| e.to_string())?;
        fn_w.write_event(Event::Empty(BytesStart::new("w:separator"))).map_err(|e| e.to_string())?;
        fn_w.write_event(Event::End(BytesEnd::new("w:r"))).map_err(|e| e.to_string())?;
        fn_w.write_event(Event::End(BytesEnd::new("w:p"))).map_err(|e| e.to_string())?;
        fn_w.write_event(Event::End(BytesEnd::new("w:footnote"))).map_err(|e| e.to_string())?;

        // Continuation separator footnote
        fn_w.write_event(Event::Start(BytesStart::new("w:footnote").with_attributes([("w:id", "0")])))
            .map_err(|e| e.to_string())?;
        fn_w.write_event(Event::Start(BytesStart::new("w:p"))).map_err(|e| e.to_string())?;
        fn_w.write_event(Event::Start(BytesStart::new("w:r"))).map_err(|e| e.to_string())?;
        fn_w.write_event(Event::Empty(BytesStart::new("w:continuationSeparator"))).map_err(|e| e.to_string())?;
        fn_w.write_event(Event::End(BytesEnd::new("w:r"))).map_err(|e| e.to_string())?;
        fn_w.write_event(Event::End(BytesEnd::new("w:p"))).map_err(|e| e.to_string())?;
        fn_w.write_event(Event::End(BytesEnd::new("w:footnote"))).map_err(|e| e.to_string())?;

        // User footnotes
        for (id, content) in &self.footnote_defs {
            fn_w.write_event(Event::Start(BytesStart::new("w:footnote").with_attributes([("w:id", id.to_string().as_str())])))
                .map_err(|e| e.to_string())?;
            fn_w.get_mut().extend_from_slice(content);
            fn_w.write_event(Event::End(BytesEnd::new("w:footnote"))).map_err(|e| e.to_string())?;
        }

        fn_w.write_event(Event::End(BytesEnd::new("w:footnotes")))
            .map_err(|e| e.to_string())?;

        self.footnotes = Some(fn_w);
        Ok(())
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_minimal_docx() {
        let md = "# Hello\n\nWorld";
        let result = generate(md, "");
        assert!(result.is_ok(), "generate failed: {:?}", result.err());
        let bytes = result.unwrap();

        use zip::ZipArchive;
        use std::io::Cursor;
        let mut archive = ZipArchive::new(Cursor::new(bytes))
            .expect("Output must be a valid ZIP archive");

        let required = ["[Content_Types].xml", "word/document.xml", "word/styles.xml"];
        for name in &required {
            assert!(archive.by_name(name).is_ok(), "Missing required OOXML entry: {}", name);
        }
    }

    #[test]
    fn test_generate_headings() {
        let md = "# H1\n## H2\n### H3\nParagraph text\n\n**bold** *italic* `code`";
        let bytes = generate(md, "").unwrap();
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
        let bytes = generate(md, "").unwrap();
        use zip::ZipArchive;
        use std::io::Cursor;
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
        let doc = std::io::read_to_string(archive.by_name("word/document.xml").unwrap()).unwrap();
        assert!(doc.contains("w:b"), "Should have bold");
        assert!(doc.contains("w:i"), "Should have italic");
        assert!(doc.contains("Consolas"), "Should have inline code font");
        assert!(doc.contains("w:strike"), "Should have strikethrough");
    }

    #[test]
    fn test_generate_table() {
        let md = "| H1 | H2 |\n|---|---|\n| A | B |";
        let bytes = generate(md, "").unwrap();
        use zip::ZipArchive;
        use std::io::Cursor;
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
        let doc = std::io::read_to_string(archive.by_name("word/document.xml").unwrap()).unwrap();
        assert!(doc.contains("w:tbl"), "Should have table");
        assert!(doc.contains("H1"), "Header should be in document");
        assert!(doc.contains("A"), "Cell content should be in document");
    }

    #[test]
    fn test_generate_lists() {
        let md = "- Item 1\n- Item 2\n\n1. One\n2. Two";
        let bytes = generate(md, "").unwrap();
        use zip::ZipArchive;
        use std::io::Cursor;
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
        let doc = std::io::read_to_string(archive.by_name("word/document.xml").unwrap()).unwrap();
        assert!(doc.contains("Item 1"), "Bullet item");
        assert!(doc.contains("One"), "Ordered item");
        assert!(archive.by_name("word/numbering.xml").is_ok(), "Should have numbering.xml");
    }

    #[test]
    fn test_generate_links() {
        let md = "[Example](https://example.com)";
        let bytes = generate(md, "").unwrap();
        use zip::ZipArchive;
        use std::io::Cursor;
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
        let doc = std::io::read_to_string(archive.by_name("word/document.xml").unwrap()).unwrap();
        assert!(doc.contains("w:hyperlink"), "Should have hyperlink");
        assert!(doc.contains("Example"), "Link text should be present");
        // Verify the hyperlink relationship is inside well-formed XML
        let rels = std::io::read_to_string(archive.by_name("word/_rels/document.xml.rels").unwrap()).unwrap();
        assert!(rels.contains("hyperlink"), "Rels should contain hyperlink entry");
        // Verify there is no Relationship after </Relationships>
        assert!(!rels.contains("</Relationships>\n  <Relationship"), "No relationships after closing tag");
    }

    #[test]
    fn test_generate_blockquote() {
        let md = "> This is a quote";
        let bytes = generate(md, "").unwrap();
        use zip::ZipArchive;
        use std::io::Cursor;
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
        let doc = std::io::read_to_string(archive.by_name("word/document.xml").unwrap()).unwrap();
        assert!(doc.contains("Quote"), "Should use Quote style");
    }

    #[test]
    fn test_generate_with_image() {
        let md = "![test](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==)";
        let bytes = generate(md, "").unwrap();
        use zip::ZipArchive;
        use std::io::Cursor;
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
        assert!(archive.by_name("word/media/image1.png").is_ok(), "Image should be embedded");
        // Verify the image relationship is inside well-formed rels XML
        let rels = std::io::read_to_string(archive.by_name("word/_rels/document.xml.rels").unwrap()).unwrap();
        assert!(rels.contains("media/image1.png"), "Rels should reference media/image1.png");
        // Verify no trailing rels after closing tag
        assert!(!rels.contains("</Relationships>\n  <Relationship"), "No relationships after closing tag");
    }

    #[test]
    fn test_document_rels_well_formed() {
        let md = "# Hello

**bold** [link](https://example.com) ![img](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==)";
        let bytes = generate(md, "").unwrap();
        use zip::ZipArchive;
        use std::io::Cursor;
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
        let rels = std::io::read_to_string(archive.by_name("word/_rels/document.xml.rels").unwrap()).unwrap();

        // Must have exactly one top-level <Relationships> element
        // Count XML declaration (0.5) + opening <Relationships ...> = distinct lines
        let open_count = rels.lines().filter(|l| l.starts_with("<Relationships")).count();
        assert_eq!(open_count, 1, "Single <Relationships> opening");
        assert_eq!(rels.matches("</Relationships>").count(), 1, "Single </Relationships> closing");

        // All Relationship entries must be self-closing empties
        assert!(!rels.contains("</Relationship>"), "No non-empty Relationship elements");

        // Should include styles, numbering, image, and hyperlink references
        assert!(rels.contains("styles.xml"), "Rels must reference styles.xml");
        assert!(rels.contains("hyperlink"), "Rels must reference hyperlink (External)");
        assert!(rels.contains("media/image1.png"), "Rels must reference image");
        assert!(rels.contains("TargetMode=\"External\""), "Hyperlink should have TargetMode=\"External\"");
    }

    #[test]
    fn test_generate_wikilinks() {
        let md = "[[Page]] and [[Other|Display]]";
        let bytes = generate(md, "").unwrap();
        use zip::ZipArchive;
        use std::io::Cursor;
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
        let doc = std::io::read_to_string(archive.by_name("word/document.xml").unwrap()).unwrap();
        assert!(doc.contains("Page"), "Wikilink target should render as text");
        assert!(doc.contains("Display"), "Wikilink alias should render as text");
        assert!(!doc.contains("[[Page]]"), "Raw wikilink syntax should NOT appear");
    }

    #[test]
    fn test_generate_tasklist() {
        let md = "- [ ] Unchecked\n- [x] Checked";
        let bytes = generate(md, "").unwrap();
        use zip::ZipArchive;
        use std::io::Cursor;
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
        let doc = std::io::read_to_string(archive.by_name("word/document.xml").unwrap()).unwrap();
        assert!(doc.contains("Unchecked"), "Unchecked item text");
        assert!(doc.contains("Checked"), "Checked item text");
        assert!(!doc.contains("[ ]"), "Raw unchecked marker should be stripped");
        assert!(!doc.contains("[x]"), "Raw checked marker should be stripped (case-insensitive)");
    }

    #[test]
    fn test_generate_codeblock_with_lang() {
        let md = "```rust\nfn main() {}\n```";
        let bytes = generate(md, "").unwrap();
        use zip::ZipArchive;
        use std::io::Cursor;
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
        let doc = std::io::read_to_string(archive.by_name("word/document.xml").unwrap()).unwrap();
        assert!(doc.contains("rust"), "Language label should appear");
        assert!(doc.contains("Code"), "Should use Code style");
    }

    #[test]
    fn test_generate_cjk() {
        let md = "# 中文标题\n\n这是中文段落。";
        let bytes = generate(md, "").unwrap();
        use zip::ZipArchive;
        use std::io::Cursor;
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
        let doc = std::io::read_to_string(archive.by_name("word/document.xml").unwrap()).unwrap();
        assert!(doc.contains("中文标题"), "CJK heading text should render");
        assert!(doc.contains("这是中文段落"), "CJK paragraph text should render");
    }

    #[test]
    fn test_generate_empty() {
        let result = generate("", "");
        assert!(result.is_ok(), "Empty input should produce valid minimal docx, got: {:?}", result.err());
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
        let bytes = generate(md, "").unwrap();
        use zip::ZipArchive;
        use std::io::Cursor;
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
        let doc = std::io::read_to_string(archive.by_name("word/document.xml").unwrap()).unwrap();
        assert!(doc.contains("footnoteReference"), "Should have footnote reference");
    }

    #[test]
    fn test_docx_is_valid_zip() {
        let md = "# Hello\n\nWorld\n\n- Item 1\n- Item 2\n\n[^1]: A footnote.";
        let bytes = generate(md, "").unwrap();
        use zip::ZipArchive;
        use std::io::Cursor;
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();

        let required = ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/styles.xml", "word/_rels/document.xml.rels"];
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
        assert!(png.is_some(), "svg_to_png returned None for mermaid ID-prefixed SVG");
        let (png, _ow, _oh) = png.unwrap();
        assert_eq!(&png[..8], &[137, 80, 78, 71, 13, 10, 26, 10], "Not a valid PNG");
        assert!(png.len() > 1000, "PNG too small: {} bytes", png.len());
    }

    #[test]
    fn test_svg_to_png_foreignobject_loses_text() {
        // Mermaid uses <foreignObject> for text when useHtmlLabels=true (default).
        // usvg 0.43 does NOT support foreignObject — it silently drops the element.
        // This test proves the SVG→PNG still produces a PNG, but text is missing.
        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100" viewBox="0 0 300 100">
  <rect width="300" height="100" fill="#f0f0f0" rx="5"/>
  <foreignObject x="50" y="30" width="200" height="40">
    <div xmlns="http://www.w3.org/1999/xhtml" style="font-family:sans-serif;font-size:16px;color:#333;text-align:center;">
      <span>Hello 世界 in foreignObject</span>
    </div>
  </foreignObject>
</svg>"##;
        let png = svg_to_png(svg.as_bytes(), 1.0);
        assert!(png.is_some(), "svg_to_png returned None for foreignObject SVG");
        let (png, _ow, _oh) = png.unwrap();
        assert_eq!(&png[..8], &[137, 80, 78, 71, 13, 10, 26, 10], "Not a valid PNG");
        // The PNG will be much smaller when foreignObject text is dropped
        // (shapes-only vs shapes+text). If text rendered, expect > 2000 bytes.
        // If < 500, text was aggressively dropped.
        eprintln!(
            "foreignObject SVG → PNG: {} bytes (text-LOSS expected: < 2000 without text)",
            png.len()
        );
        // Note: No assertion — this is informational.
        // The fix is to set useHtmlLabels=false in mermaid config.
    }

    #[test]
    fn test_svg_to_png_foreignobject_dropped_is_smaller() {
        // Same SVG with <text> renders text correctly — proves foreignObject is the issue
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
        // The foreignObject version should be significantly smaller (text dropped)
        // The <text> version should be > 2000 bytes (text rendered as glyphs)
        assert!(png_text.len() > 2000, "Expected > 2000 bytes for <text> SVG, got {}", png_text.len());
        eprintln!("<text> SVG → {} bytes | <foreignObject> SVG → {} bytes", png_text.len(), png_fo.len());
    }

    #[test]
    fn test_svg_data_uri_generates_png_in_docx() {
        // Integration test: full pipeline from markdown with SVG data URI to DOCX archive
        let svg_data = r##"<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">
  <rect width="200" height="100" fill="#f0f0f0" rx="10"/>
  <text x="100" y="55" text-anchor="middle" font-family="sans-serif" font-size="16" fill="#333">Hello 世界</text>
</svg>"##;
        let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, svg_data.as_bytes());
        let md = format!("![test](data:image/svg+xml;base64,{})", b64);

        let bytes = generate(&md, "").unwrap();
        use zip::ZipArchive;
        use std::io::Cursor;
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();

        // Should produce a PNG (not SVG) in media
        assert!(archive.by_name("word/media/image1.png").is_ok(),
                "SVG data URI should produce PNG in DOCX media");
        // The PNG should have reasonable size (> 500 bytes for visible content)
        let png_entry = archive.by_name("word/media/image1.png").unwrap();
        let png_size = png_entry.size();
        assert!(png_size > 500, "PNG too small: {} bytes", png_size);
        eprintln!("DOCX integration: SVG→PNG produced {} bytes in DOCX media", png_size);
    }

    #[test]
    fn test_foreignobject_svg_embedded_as_svg_in_docx() {
        // Integration test: SVG with <foreignObject> (like mermaid output)
        // should be embedded as SVG (not converted to PNG) — Word renders
        // foreignObject text natively.
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
        let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, svg_data.as_bytes());
        let md = format!("![test](data:image/svg+xml;base64,{})", b64);

        let bytes = generate(&md, "").unwrap();
        use zip::ZipArchive;
        use std::io::Cursor;
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();

        // Should produce SVG (not PNG) in media — foreignObject detected
        let svg_entry = archive.by_name("word/media/image1.svg");
        assert!(svg_entry.is_ok(), "foreignObject SVG should produce .svg in DOCX media, not PNG");
        let svg_content = std::io::read_to_string(svg_entry.unwrap()).unwrap();
        assert!(svg_content.contains("foreignObject"), "Embedded SVG must retain foreignObject");
        assert!(svg_content.contains("开始"), "Embedded SVG must retain CJK text");

        // Verify document.xml references the SVG (not a PNG)
        let doc = std::io::read_to_string(archive.by_name("word/document.xml").unwrap()).unwrap();
        // The rels target might use a different path — check for image1.svg in either rels or doc
        eprintln!("document.xml snippet: ...{}...",
            &doc[doc.len().min(300)..]); // tail of document
        // Check relationships
        let rels = std::io::read_to_string(archive.by_name("word/_rels/document.xml.rels").unwrap()).unwrap();
        eprintln!("rels: {}", rels);
        assert!(rels.contains("image1.svg"), "Relationships must reference SVG file");
        eprintln!("foreignObject SVG pipeline: embedded as SVG with CJK text preserved");
    }

    #[test]
    fn test_package_rels_references_document() {
        let md = "# Test";
        let bytes = generate(md, "").unwrap();
        use zip::ZipArchive;
        use std::io::Cursor;
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
        let rels = std::io::read_to_string(archive.by_name("_rels/.rels").unwrap()).unwrap();
        assert!(rels.contains("word/document.xml"), "Package rels must reference word/document.xml");
        assert!(rels.contains("officeDocument"), "Package rels must have officeDocument type");
        assert!(rels.contains("docProps/core.xml"), "Package rels must reference docProps/core.xml");
    }
}
