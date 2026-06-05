# src/ — Rust Source Core

15 modules across 16 files — Tauri IPC commands, comrak markdown parsing, printpdf export, filesystem I/O.

## MODULE MAP

```
lib.rs (pub fn run → Tauri builder)
├── commands (re-exports 8 submodules)
├── config   (AppConfig struct, load/save JSON)
├── export   (export_to_html, export_to_pdf, export_to_docx)
├── filesystem (FileEntry, read/write/create/delete)
└── markdown (parsing, TocItem, DocumentStats)
```

## WHERE TO LOOK

| Task | File | Notes |
|------|------|-------|
| Add Tauri command | `commands/` + `commands.rs` + `lib.rs` | 3-file registration chain |
| Understand exports | `export.rs` | 1415 lines, complexity hotspot |
| Markdown parsing | `markdown.rs` | comrak + syntect |
| File operations | `filesystem.rs` | Read/write/delete/rename |
| Config management | `config.rs` | AppConfig JSON on filesystem |
| All Tauri tests | `export.rs` | 3 tests inline, only tests in project |

## CONVENTIONS

- `lib.rs` calls `tauri_build::build()` — standard Tauri 2
- Commands return `Result<T, String>` — error strings shown in frontend
- Config duality: `src/config.rs` (struct/IO) vs `commands/config.rs` (Tauri handlers) — same name, separate modules
- `export.rs` is the complexity hotspot (HTML/PDF/DOCX in one file, plus tests)
- Only tests: 3 inline `#[cfg(test)]` in `export.rs` — no integration tests, no doc tests
- Zero `unsafe` blocks, zero `#[allow(...)]`, zero `panic!()` calls
