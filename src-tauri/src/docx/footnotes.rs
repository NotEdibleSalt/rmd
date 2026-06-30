use super::*;

impl DocxWriter {
    pub(super) fn collect_footnotes<'a>(&mut self, root: &'a AstNode<'a>) {
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

    pub(super) fn resolve_footnote_id(&self, original: u64) -> u64 {
        // Simple pass-through — comrak IDs should be 1-based and contiguous
        original
    }

    pub(super) fn write_footnote_reference(&mut self, id: u64) {
        let w = &mut self.document;
        w.write_event(Event::Start(BytesStart::new("w:r"))).unwrap();
        let mut ref_elem = BytesStart::new("w:footnoteReference");
        ref_elem.push_attribute(("w:id", id.to_string().as_str()));
        w.write_event(Event::Empty(ref_elem)).unwrap();
        w.write_event(Event::End(BytesEnd::new("w:r"))).unwrap();
    }

    pub(super) fn write_footnotes_part(&mut self) -> Result<(), String> {
        let mut fn_w = Writer::new_with_indent(Vec::new(), b' ', 2);
        fn_w.write_event(Event::Decl(BytesDecl::new("1.0", Some("UTF-8"), None)))
            .map_err(|e| e.to_string())?;
        fn_w.write_event(Event::Start(
            BytesStart::new("w:footnotes")
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

        // Separator footnote (Word requires it)
        fn_w.write_event(Event::Start(
            BytesStart::new("w:footnote").with_attributes([("w:id", "-1")]),
        ))
        .map_err(|e| e.to_string())?;
        fn_w.write_event(Event::Start(BytesStart::new("w:p")))
            .map_err(|e| e.to_string())?;
        fn_w.write_event(Event::Start(BytesStart::new("w:r")))
            .map_err(|e| e.to_string())?;
        fn_w.write_event(Event::Empty(BytesStart::new("w:separator")))
            .map_err(|e| e.to_string())?;
        fn_w.write_event(Event::End(BytesEnd::new("w:r")))
            .map_err(|e| e.to_string())?;
        fn_w.write_event(Event::End(BytesEnd::new("w:p")))
            .map_err(|e| e.to_string())?;
        fn_w.write_event(Event::End(BytesEnd::new("w:footnote")))
            .map_err(|e| e.to_string())?;

        // Continuation separator footnote
        fn_w.write_event(Event::Start(
            BytesStart::new("w:footnote").with_attributes([("w:id", "0")]),
        ))
        .map_err(|e| e.to_string())?;
        fn_w.write_event(Event::Start(BytesStart::new("w:p")))
            .map_err(|e| e.to_string())?;
        fn_w.write_event(Event::Start(BytesStart::new("w:r")))
            .map_err(|e| e.to_string())?;
        fn_w.write_event(Event::Empty(BytesStart::new("w:continuationSeparator")))
            .map_err(|e| e.to_string())?;
        fn_w.write_event(Event::End(BytesEnd::new("w:r")))
            .map_err(|e| e.to_string())?;
        fn_w.write_event(Event::End(BytesEnd::new("w:p")))
            .map_err(|e| e.to_string())?;
        fn_w.write_event(Event::End(BytesEnd::new("w:footnote")))
            .map_err(|e| e.to_string())?;

        // User footnotes
        for (id, content) in &self.footnote_defs {
            fn_w.write_event(Event::Start(
                BytesStart::new("w:footnote").with_attributes([("w:id", id.to_string().as_str())]),
            ))
            .map_err(|e| e.to_string())?;
            fn_w.get_mut().extend_from_slice(content);
            fn_w.write_event(Event::End(BytesEnd::new("w:footnote")))
                .map_err(|e| e.to_string())?;
        }

        fn_w.write_event(Event::End(BytesEnd::new("w:footnotes")))
            .map_err(|e| e.to_string())?;

        self.footnotes = Some(fn_w);
        Ok(())
    }
}

/// Walk a sub-tree and write to an arbitrary writer (for footnotes content)
fn render_to_writer<'a>(node: &'a AstNode<'a>, writer: &mut Writer<Vec<u8>>, _base_path: &str) {
    match &node.data.borrow().value {
        NodeValue::Paragraph => {
            writer
                .write_event(Event::Start(BytesStart::new("w:p")))
                .unwrap();
            for child in node.children() {
                render_to_writer(child, writer, _base_path);
            }
            writer
                .write_event(Event::End(BytesEnd::new("w:p")))
                .unwrap();
        }
        NodeValue::Text(text) => {
            writer
                .write_event(Event::Start(BytesStart::new("w:r")))
                .unwrap();
            writer
                .write_event(Event::Start(BytesStart::new("w:t")))
                .unwrap();
            writer
                .write_event(Event::Text(BytesText::new(text)))
                .unwrap();
            writer
                .write_event(Event::End(BytesEnd::new("w:t")))
                .unwrap();
            writer
                .write_event(Event::End(BytesEnd::new("w:r")))
                .unwrap();
        }
        NodeValue::Strong => {
            writer
                .write_event(Event::Start(BytesStart::new("w:r")))
                .unwrap();
            writer
                .write_event(Event::Empty(BytesStart::new("w:b")))
                .unwrap();
            for child in node.children() {
                render_to_writer(child, writer, _base_path);
            }
            writer
                .write_event(Event::End(BytesEnd::new("w:r")))
                .unwrap();
        }
        _ => {
            for child in node.children() {
                render_to_writer(child, writer, _base_path);
            }
        }
    }
}
