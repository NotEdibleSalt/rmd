# commands/ — Tauri 2 IPC Command Handlers

8 thin handler modules bridging Rust backend to React frontend via `#[tauri::command]`.

## FILES

| File | Commands | Delegates To |
|------|----------|-------------|
| `close.rs` | `app_allow_close` | `crate::` AtomicBool state |
| `config.rs` | `get_config`, `set_config` | `crate::config` |
| `export.rs` | `export_html`, `export_pdf`, `export_docx` | `crate::export` |
| `file.rs` | `open_file`, `save_file`, `read_dir`, `create_file`, `delete_file`, `rename_file` | `crate::filesystem` |
| `image.rs` | `save_image`, `read_image_base64` | `crate::filesystem` |
| `markdown.rs` | `parse_markdown` | `crate::markdown` |
| `search.rs` | `search_files` | Direct (grep `.md`/`.txt`) |
| `theme.rs` | `set/list/upload/delete_external_theme` | Direct (filesystem I/O) |

## CONVENTIONS

- Each command returns `Result<T, String>` — errors propagate to frontend as strings
- Thin delegation: commands parse Tauri args, call core modules, map errors
- Registration chain: file → `commands.rs` (`pub mod`) → `lib.rs` (`generate_handler![]`) → `capabilities/default.json` (permissions)
- No business logic — pure IPC translation layer
