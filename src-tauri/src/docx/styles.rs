use super::*;

impl DocxWriter {
    pub(super) fn write_styles(&mut self) -> Result<(), String> {
        self.styles
            .write_event(Event::Decl(BytesDecl::new("1.0", Some("UTF-8"), None)))
            .map_err(|e| e.to_string())?;
        self.styles
            .write_event(Event::Start(
                BytesStart::new("w:styles").with_attributes([(
                    "xmlns:w",
                    "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
                )]),
            ))
            .map_err(|e| e.to_string())?;

        // Extract theme values to owned strings to avoid borrowing self in closures
        let body_font = if self.theme.body_font.is_empty() {
            "Calibri".to_string()
        } else {
            self.theme.body_font.clone()
        };
        let head_font = if self.theme.heading_font.is_empty() {
            "Calibri".to_string()
        } else {
            self.theme.heading_font.clone()
        };
        let code_font = if self.theme.code_font.is_empty() {
            "Consolas".to_string()
        } else {
            self.theme.code_font.clone()
        };
        let body_color = self.theme.body_color.clone();
        let code_bg = if self.theme.code_bg.is_empty() {
            "F5F5F5".to_string()
        } else {
            self.theme.code_bg.clone()
        };
        let code_color = if !self.theme.code_color.is_empty() {
            self.theme.code_color.clone()
        } else {
            body_color.clone()
        };

        // Normal style
        self.write_style("Normal", "Normal", "Para", true, |w| {
            w.write_event(Event::Start(BytesStart::new("w:pPr"))).unwrap();
            let mut spacing = BytesStart::new("w:spacing");
            spacing.push_attribute(("w:line", "276")); // 1.15 line spacing (240 * 1.15)
            spacing.push_attribute(("w:lineRule", "auto"));
            w.write_event(Event::Empty(spacing)).unwrap();
            w.write_event(Event::End(BytesEnd::new("w:pPr"))).unwrap();
            w.write_event(Event::Start(BytesStart::new("w:rPr"))).unwrap();
            write_rfont(w, &body_font);
            write_sz(w, 22); // 11pt * 2
            if !body_color.is_empty() {
                let mut col_elem = BytesStart::new("w:color");
                col_elem.push_attribute(("w:val", body_color.as_str()));
                w.write_event(Event::Empty(col_elem)).unwrap();
            }
            w.write_event(Event::End(BytesEnd::new("w:rPr"))).unwrap();
        })?;

        // Heading 1-6 styles — keep structural data, apply theme font/color
        let headings: [(&str, &str, u16, &str); 6] = [
            ("Heading1", "heading 1", 48, "true"),
            ("Heading2", "heading 2", 36, "true"),
            ("Heading3", "heading 3", 28, "true"),
            ("Heading4", "heading 4", 24, "false"),
            ("Heading5", "heading 5", 22, "true"),
            ("Heading6", "heading 6", 20, "true"),
        ];
        for (style_id, name, sz, bold) in &headings {
            self.write_style(style_id, name, "Para", false, |w| {
                w.write_event(Event::Start(BytesStart::new("w:pPr"))).unwrap();
                let mut spacing = BytesStart::new("w:spacing");
                spacing.push_attribute(("w:before", "240")); // 12pt before
                spacing.push_attribute(("w:after", "120")); // 6pt after
                w.write_event(Event::Empty(spacing)).unwrap();
                w.write_event(Event::End(BytesEnd::new("w:pPr"))).unwrap();
                w.write_event(Event::Start(BytesStart::new("w:rPr"))).unwrap();
                write_rfont(w, &head_font);
                if *bold == "true" {
                    w.write_event(Event::Empty(BytesStart::new("w:b"))).unwrap();
                }
                if *style_id == "Heading4" {
                    w.write_event(Event::Empty(BytesStart::new("w:i"))).unwrap();
                }
                if !body_color.is_empty() {
                    let mut col_elem = BytesStart::new("w:color");
                    col_elem.push_attribute(("w:val", body_color.as_str()));
                    w.write_event(Event::Empty(col_elem)).unwrap();
                }
                write_sz(w, *sz);
                w.write_event(Event::End(BytesEnd::new("w:rPr"))).unwrap();
            })?;
        }

        // Code paragraph style
        self.write_style("Code", "Code", "Para", false, |w| {
            w.write_event(Event::Start(BytesStart::new("w:rPr"))).unwrap();
            write_rfont(w, &code_font);
            write_sz(w, 19);
            if !code_color.is_empty() {
                let mut col = BytesStart::new("w:color");
                col.push_attribute(("w:val", code_color.as_str()));
                w.write_event(Event::Empty(col)).unwrap();
            }
            let mut shd = BytesStart::new("w:shd");
            shd.push_attribute(("w:val", "clear"));
            shd.push_attribute(("w:fill", code_bg.as_str()));
            w.write_event(Event::Empty(shd)).unwrap();
            w.write_event(Event::End(BytesEnd::new("w:rPr"))).unwrap();
        })?;

        // Code character style (for inline code)
        self.write_style("CodeLang", "CodeLang", "Char", false, |w| {
            w.write_event(Event::Start(BytesStart::new("w:rPr"))).unwrap();
            write_rfont(w, &code_font);
            write_sz(w, 19);
            if !code_color.is_empty() {
                let mut col = BytesStart::new("w:color");
                col.push_attribute(("w:val", code_color.as_str()));
                w.write_event(Event::Empty(col)).unwrap();
            }
            let mut shd = BytesStart::new("w:shd");
            shd.push_attribute(("w:val", "clear"));
            shd.push_attribute(("w:fill", code_bg.as_str()));
            w.write_event(Event::Empty(shd)).unwrap();
            w.write_event(Event::End(BytesEnd::new("w:rPr"))).unwrap();
        })?;

        // ListParagraph style
        self.write_style("ListParagraph", "List Paragraph", "Para", false, |w| {
            w.write_event(Event::Start(BytesStart::new("w:pPr"))).unwrap();
            let mut ind = BytesStart::new("w:ind");
            ind.push_attribute(("w:left", "720"));
            w.write_event(Event::Empty(ind)).unwrap();
            w.write_event(Event::End(BytesEnd::new("w:pPr"))).unwrap();
            w.write_event(Event::Start(BytesStart::new("w:rPr"))).unwrap();
            write_rfont(w, &body_font);
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
            write_rfont(w, &body_font);
            write_sz(w, 22);
            w.write_event(Event::Empty(BytesStart::new("w:i"))).unwrap();
            w.write_event(Event::End(BytesEnd::new("w:rPr"))).unwrap();
        })?;

        self.styles
            .write_event(Event::End(BytesEnd::new("w:styles")))
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn write_style<F>(&mut self, id: &str, name: &str, stype: &str, is_default: bool, f: F) -> Result<(), String>
    where
        F: Fn(&mut Writer<Vec<u8>>),
    {
        let w = &mut self.styles;
        let mut style = BytesStart::new("w:style");
        style.push_attribute(("w:styleId", id));
        style.push_attribute(("w:type", stype));
        if is_default {
            style.push_attribute(("w:default", "1"));
        }
        w.write_event(Event::Start(style))
            .map_err(|e| e.to_string())?;

        let mut name_elem = BytesStart::new("w:name");
        name_elem.push_attribute(("w:val", name));
        w.write_event(Event::Empty(name_elem))
            .map_err(|e| e.to_string())?;

        f(w);

        w.write_event(Event::End(BytesEnd::new("w:style")))
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}
