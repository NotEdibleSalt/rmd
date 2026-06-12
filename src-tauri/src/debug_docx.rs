#[cfg(test)]
mod debug_docx {
    use std::io::Cursor;
    use zip::ZipArchive;
    use crate::docx::generate;

    #[test]
    fn inspect_docx() {
        let md = "# Hello World

This is **bold** and *italic* text.

## Section 2

- List item 1
- List item 2

![test](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==)

| Col1 | Col2 |
|------|------|
| A | B |

> Blockquote

`ust
fn main() {}
`
";
        let bytes = generate(md, "").unwrap();
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
        
        // List all entries
        for i in 0..archive.len() {
            let entry = archive.by_index(i).unwrap();
            println!("ENTRY: {} ({} bytes)", entry.name(), entry.size());
        }
        
        // Print content of key files
        for name in &["[Content_Types].xml", "_rels/.rels", "word/_rels/document.xml.rels", "word/document.xml", "word/styles.xml"] {
            if let Ok(mut f) = archive.by_name(name) {
                let content = std::io::read_to_string(&mut f).unwrap();
                println!("\n=== {} ===", name);
                println!("{}", &content[..content.len().min(2000)]);
            }
        }
    }
}
