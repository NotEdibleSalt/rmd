# src-tauri/ — Tauri 2 Rust Backend

Rust backend for rmd desktop app: Tauri 2 shell, comrak markdown parsing, printpdf export, syntect syntax highlighting.

## STRUCTURE

```
src-tauri/
├── src/           # Rust source (see src/AGENTS.md)
├── Cargo.toml     # Package: rmd, lib: rmd_lib, crate-type: [staticlib,cdylib,rlib]
├── build.rs       # Standard tauri_build::build()
├── tauri.conf.json # Window: 1400×900, CSP: null, assetProtocol: ["**"]
├── capabilities/
│   └── default.json # ACL permissions for fs, shell, clipboard, dialog
├── icons/         # App icons (16 .png/.ico/.icns)
├── gen/schemas/   # Auto-generated, gitignored
└── examples/      # Empty — placeholder
```

## COMMANDS

```bash
# Dev (from project root)
npm run tauri dev

# Build prod (from project root)
npm run tauri build

# Rust tests only
cd src-tauri && cargo test

# Check Rust only
cd src-tauri && cargo check
```

## CONVENTIONS

- Tauri 2 pattern: `#[tauri::command]` in `commands/*.rs`, registered via `generate_handler![]` in `lib.rs`
- Plugins: opener, dialog, fs, shell, clipboard-manager
- Lib named `rmd_lib` (Windows bin name workaround — see Cargo.toml comment)
- CSP disabled (`null`), asset protocol scope `["**"]` — intentional for local markdown content that may reference arbitrary assets
- Bundle targets: "all" (msi, dmg, AppImage, deb)

## NOTES

- No CI/CD (add before shipping)
- No `rust-toolchain.toml` — uses whatever stable rustc is in PATH
- No custom clippy or rustfmt config
- `Cargo.lock` is inside `src-tauri/` (standard for Tauri: src-tauri is the crate root)
