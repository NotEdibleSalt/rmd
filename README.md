# rmd — Rich Markdown Editor

A desktop markdown editor with WYSIWYG editing, built with **Tauri 2** (Rust backend) + **React 19** (TypeScript frontend).

## Features

- **Dual editing modes** — WYSIWYG (TipTap/ProseMirror) and Source (CodeMirror)
- **Export** — HTML, DOCX, PDF — all with markdown theme CSS styling
- **Syntax highlighting** in code blocks (lowlight + CodeMirror)
- **Math** — KaTeX inline and block LaTeX
- **Mermaid diagrams** — render and edit Mermaid charts directly in the editor
- **Tables** with full WYSIWYG support, including GFM table auto-detection (type `|` or paste a table to auto-convert)
- **Task lists** — checkable todo items
- **Links & images** — inline editing with link edit popover
- **Bubble menu** — formatting toolbar appears on text selection
- **Find & replace** — in-document search with replace support (<kbd>Ctrl+F</kbd>)
- **File browser** — navigate and open files with keyboard navigation
- **Search** — full-text search across documents
- **Outline view** — heading-based document navigation
- **Status bar** — word count, cursor position, save status indicator
- **Welcome screen** — empty state with quick actions
- **Tab bar** — multi-file editing with context menu
- **Keyboard shortcuts panel** — discoverable shortcuts reference
- **Settings panel** — customizable preferences
- **Theme system** — multiple editor themes (light, dark, eye-care, minimal) and customizable markdown rendering themes
- **Dark/Light mode** — syncs with system preference

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Tauri 2 |
| Frontend | React 19, TypeScript, Vite 7, Tailwind 4 |
| Rich text editor | TipTap (ProseMirror) |
| Source editor | CodeMirror 6 |
| Rust crates | comrak (markdown parsing), printpdf (PDF), syntect (syntax highlighting) |

## Getting Started

```bash
# Install dependencies
npm install

# Run in development mode
npm run tauri dev

# Build for production
npm run tauri build
```

## Requirements

- Rust toolchain (stable)
- Node.js 20+
- Platform-specific Tauri prerequisites (see [Tauri docs](https://v2.tauri.app/start/prerequisites/))
