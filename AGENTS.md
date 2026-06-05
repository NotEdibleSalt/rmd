# PROJECT KNOWLEDGE BASE

**Generated:** 2026-05-17
**Commit:** `86d2b2a`
**Branch:** `main`

## OVERVIEW

**rmd** — Rich Markdown Editor. Desktop app: Tauri 2 (Rust backend) + React 19/TypeScript (Vite 7 frontend). WYSIWYG + Source markdown editing with export to HTML/PDF/DOCX.

## STRUCTURE

```
./
├── src/              # Frontend (React 19, TypeScript, Tailwind 4)
├── src-tauri/        # Rust backend (Tauri 2, comrak, printpdf)
├── dist/             # Vite build output (gitignored)
├── public/           # Static assets
└── .sisyphus/        # Tooling artifacts (untracked)
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add Tauri command | `src-tauri/src/commands/` | Register in `lib.rs` + `capabilities/default.json` |
| Modify editor UI | `src/WysiwygEditor.tsx` | TipTap/ProseMirror |
| Export logic (Rust) | `src-tauri/src/export.rs` | HTML/PDF/DOCX, 1415 lines |
| Markdown parsing | `src-tauri/src/markdown.rs` | comrak + syntect |
| App state | `src/store.ts` | Zustand |
| Themes | `src/theme/` | CSS-based theme system |
| File operations | `src-tauri/src/filesystem.rs` | Read/write/delete files |

## CONVENTIONS

- Rust 2021 edition, no custom fmt/clippy config
- CLI: `npm run tauri dev` / `npm run tauri build`
- Tauri 2 commands: `#[tauri::command]` in `commands/*.rs`, registered via `generate_handler![]`
- `src-tauri/src/config.rs` = AppConfig struct, `commands/config.rs` = Tauri command handlers (separate despite same name)
- Lib crate named `rmd_lib` (Windows bin name workaround, see Cargo.toml)
- `crate-type = ["staticlib", "cdylib", "rlib"]` (Tauri requirement)
- CSP disabled (`null`), `assetProtocol.scope: ["**"]` — permissive security model (intentional for local app)
- CSS: Tailwind 4 utility classes (no CSS modules or styled-components)

## ANTI-PATTERNS (THIS PROJECT)

- **DO NOT** remove `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]` from `main.rs` — prevents console window on Windows release builds
- **AVOID** `unwrap()` on non-`Regex::new()` calls — 18 existing unwraps (7 production, all on `Regex::new` with literal patterns); prefer `?` or `unwrap_or_default()`
- **NO** `#[allow(...)]` exists yet — keep it that way; suppress nothing
- **NO** CI/CD exists — add before shipping

## COMMANDS

```bash
# Dev
npm run tauri dev

# Production build
npm run tauri build

# Rust tests only
cd src-tauri && cargo test

# Frontend build only
npm run build
```

## NOTES

- Single commit (`86d2b2a`) — fresh/squashed repo
- No `rust-toolchain.toml` — uses whatever `rustc` stable is in PATH
- Only 3 tests exist, all in `export.rs` — no integration tests, no frontend tests
- Empty `src-tauri/examples/` directory — unused placeholder
- `.sisyphus/` directory at root — tooling artifacts, add to `.gitignore`
