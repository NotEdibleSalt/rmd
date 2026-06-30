use super::*;

// ═══════════════════════════════════════════════════════════════════════
// Image dimension parsing
// ═══════════════════════════════════════════════════════════════════════

/// Parse (width, height) in pixels from decoded image bytes.
/// Supports PNG (IHDR), JPEG (SOF0), and GIF (header).
/// For SVG and WebP, or on failure, returns (100, 100) as fallback.
pub(super) fn parse_image_dimensions(data: &[u8]) -> (u32, u32) {
    // PNG: 8-byte signature + IHDR chunk: 4 len + 4 "IHDR" + 4 W + 4 H
    if data.len() >= 24 && data[0..8] == [137, 80, 78, 71, 13, 10, 26, 10] {
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
                            if s.is_empty() {
                                return None;
                            }
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
pub(super) fn px_to_emu(px: u32) -> i64 {
    (px as f64 * 914_400.0 / 96.0) as i64
}

/// Convert SVG byte data to a PNG byte vector using resvg.
/// Returns None on parse/render failure.
/// Lazily-initialised font database with system fonts loaded.
/// Cached to avoid re-loading thousands of fonts on every SVG conversion.
pub(super) fn system_fontdb() -> &'static std::sync::Arc<usvg::fontdb::Database> {
    static FONTDB: std::sync::OnceLock<std::sync::Arc<usvg::fontdb::Database>> =
        std::sync::OnceLock::new();
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

pub(super) fn svg_to_png(svg_data: &[u8], scale: f64) -> Option<(Vec<u8>, u32, u32)> {
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
        None => {
            eprintln!("[DOCX] svg_to_png: zero-size pixmap ({scaled_w}x{scaled_h})");
            return None;
        }
    };
    let ts = resvg::tiny_skia::Transform::from_scale(scale as f32, scale as f32);
    resvg::render(&tree, ts, &mut pixmap.as_mut());
    match pixmap.encode_png() {
        Ok(png) => Some((png, orig_w, orig_h)),
        Err(e) => {
            eprintln!("[DOCX] svg_to_png: PNG encode error: {e}");
            None
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Image writing
// ═══════════════════════════════════════════════════════════════════════

impl DocxWriter {
    pub(super) fn write_image(&mut self, url: &str, alt: &str, _base_path: &str) {
        if !url.starts_with("data:") {
            // Non-data URI — try fallback with text
            self.write_text_run(&format!("[Image: {}]", alt));
            return;
        }

        // Parse data URI: data:image/{ext};base64,{data}
        let rest = url.strip_prefix("data:").unwrap_or(url);
        let (mime_part, b64) = match rest.split_once(',') {
            Some((m, d)) => (m, d),
            None => {
                self.write_text_run(&format!("[Image: {}]", alt));
                return;
            }
        };

        // Determine extension
        let ext = if mime_part.contains("svg") {
            "svg"
        } else if mime_part.contains("png") {
            "png"
        } else if mime_part.contains("jpeg") || mime_part.contains("jpg") {
            "jpg"
        } else if mime_part.contains("gif") {
            "gif"
        } else if mime_part.contains("webp") {
            "webp"
        } else {
            "png"
        };

        // Decode base64
        let mut decoded = match base64::Engine::decode(
            &base64::engine::general_purpose::STANDARD,
            b64.trim(),
        ) {
            Ok(d) => d,
            Err(_) => {
                self.write_text_run(&format!("[Image: {}]", alt));
                return;
            }
        };

        // SVG images — convert to high-DPI PNG for clarity in DOCX
        // foreignObject SVGs are embedded directly (Word renders them natively).
        let has_fo = decoded.windows(13).any(|w| w == b"foreignObject");
        if ext == "svg" {
            eprintln!(
                "[DOCX] SVG image: {} bytes, foreignObject={}, action={}",
                decoded.len(),
                has_fo,
                if has_fo {
                    "embed SVG (Word renders text)"
                } else {
                    "convert to 2x PNG"
                }
            );
            if !has_fo {
                // Render at 2x for sharp output; keep original dims for display
                if let Some((png_data, ow, oh)) = svg_to_png(&decoded, 2.0) {
                    decoded = png_data;
                    // ponytail: shadow ext to "png" for correct media type
                    let ext = "png";
                    // Need to continue with ext being "png" for image_name
                    let image_name = format!("image{}.{}", self.images.len() + 1, ext);
                    self.do_write_image(&decoded, &image_name, alt, ow, oh);
                    return;
                }
                // Fall through to normal image writing below
            }
        }

        let image_name = format!("image{}.{}", self.images.len() + 1, ext);
        let (w_px, h_px) = parse_image_dimensions(&decoded);
        self.do_write_image(&decoded, &image_name, alt, w_px, h_px);
    }

    /// Shared image writing: registers relationship + writes OOXML drawing element
    fn do_write_image(&mut self, decoded: &[u8], image_name: &str, alt: &str, w_px: u32, h_px: u32) {
        let cx = px_to_emu(w_px.max(1));
        let cy = px_to_emu(h_px.max(1));
        let cx_str = cx.to_string();
        let cy_str = cy.to_string();
        self.images.push((image_name.to_string(), decoded.to_vec()));

        // Register relationship
        self.rel_id_counter += 1;
        let rid = format!("rId{}", self.rel_id_counter);
        self.rels_entries.push(RelEntry {
            id: rid.clone(),
            rel_type:
                "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
                    .to_string(),
            target: format!("media/{}", image_name),
            target_mode: None,
        });

        // Write drawing element
        let w = &mut self.document;
        w.write_event(Event::Start(BytesStart::new("w:r"))).unwrap();
        w.write_event(Event::Start(BytesStart::new("w:drawing")))
            .unwrap();
        w.write_event(Event::Start(
            BytesStart::new("wp:inline")
                .with_attributes([(
                    "xmlns:wp",
                    "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
                )])
                .with_attributes([(
                    "xmlns:a",
                    "http://schemas.openxmlformats.org/drawingml/2006/main",
                )])
                .with_attributes([(
                    "xmlns:r",
                    "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
                )]),
        ))
        .unwrap();

        w.write_event(Event::Empty(
            BytesStart::new("wp:extent")
                .with_attributes([("cx", cx_str.as_str())])
                .with_attributes([("cy", cy_str.as_str())]),
        ))
        .unwrap();

        w.write_event(Event::Start(
            BytesStart::new("wp:docPr")
                .with_attributes([("id", "1")])
                .with_attributes([("name", alt)]),
        ))
        .unwrap();
        w.write_event(Event::End(BytesEnd::new("wp:docPr"))).unwrap();

        w.write_event(Event::Start(BytesStart::new("a:graphic")))
            .unwrap();
        w.write_event(Event::Start(
            BytesStart::new("a:graphicData")
                .with_attributes([("uri", "http://schemas.openxmlformats.org/drawingml/2006/picture")]),
        ))
        .unwrap();
        w.write_event(Event::Start(
            BytesStart::new("pic:pic").with_attributes([(
                "xmlns:pic",
                "http://schemas.openxmlformats.org/drawingml/2006/picture",
            )]),
        ))
        .unwrap();

        w.write_event(Event::Start(BytesStart::new("pic:blipFill")))
            .unwrap();
        w.write_event(Event::Empty(
            BytesStart::new("a:blip").with_attributes([("r:embed", rid.as_str())]),
        ))
        .unwrap();
        w.write_event(Event::End(BytesEnd::new("pic:blipFill")))
            .unwrap();

        w.write_event(Event::Start(BytesStart::new("pic:spPr")))
            .unwrap();
        w.write_event(Event::Start(BytesStart::new("a:xfrm"))).unwrap();
        w.write_event(Event::Empty(
            BytesStart::new("a:off")
                .with_attributes([("x", "0")])
                .with_attributes([("y", "0")]),
        ))
        .unwrap();
        w.write_event(Event::Empty(
            BytesStart::new("a:ext")
                .with_attributes([("cx", cx_str.as_str())])
                .with_attributes([("cy", cy_str.as_str())]),
        ))
        .unwrap();
        w.write_event(Event::End(BytesEnd::new("a:xfrm"))).unwrap();
        w.write_event(Event::Start(
            BytesStart::new("a:prstGeom").with_attributes([("prst", "rect")]),
        ))
        .unwrap();
        w.write_event(Event::End(BytesEnd::new("a:prstGeom")))
            .unwrap();
        w.write_event(Event::End(BytesEnd::new("pic:spPr"))).unwrap();

        w.write_event(Event::End(BytesEnd::new("pic:pic"))).unwrap();
        w.write_event(Event::End(BytesEnd::new("a:graphicData")))
            .unwrap();
        w.write_event(Event::End(BytesEnd::new("a:graphic")))
            .unwrap();
        w.write_event(Event::End(BytesEnd::new("wp:inline"))).unwrap();
        w.write_event(Event::End(BytesEnd::new("w:drawing"))).unwrap();
        w.write_event(Event::End(BytesEnd::new("w:r"))).unwrap();
    }
}
