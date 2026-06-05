# src/ — Frontend (React 19 + TypeScript)

React 19/TypeScript frontend for rmd — TipTap WYSIWYG + CodeMirror source editor powered by Vite 7, Tailwind 4.

## FILES

| File | Role |
|------|------|
| `main.tsx` | React entry point (`createRoot`) |
| `App.tsx` | Root component, editor shell layout |
| `WysiwygEditor.tsx` | TipTap/ProseMirror rich text editor (largest) |
| `SourceEditor.tsx` | CodeMirror 6 source mode editor |
| `Toolbar.tsx` | Editor toolbar (formatting, insert, etc.) |
| `store.ts` | Zustand state store |
| `FileBrowser.tsx` | File navigation sidebar |
| `SearchPanel.tsx` | Full-text search within documents |
| `OutlineView.tsx` | Heading-based TOC sidebar |
| `ExportDialog.tsx` | Export to HTML/PDF/DOCX |
| `SettingsPanel.tsx` | App settings |
| `SavePromptModal.tsx` | Unsaved changes dialog |
| `DocPreview.tsx` | Read-only markdown preview |
| `StatusBar.tsx` | Word count, cursor position |
| `editor-ref.ts` | Editor ref forwarding |
| `theme/` | Markdown theme CSS system |
| `utils/` | Debounce + image utilities |

## WHERE TO LOOK

| Task | File |
|------|------|
| Editor behavior | `WysiwygEditor.tsx`, `SourceEditor.tsx` |
| State management | `store.ts` |
| Export UI | `ExportDialog.tsx` |
| File operations UI | `FileBrowser.tsx` |
| Add toolbar button | `Toolbar.tsx` |

## CONVENTIONS

- State: Zustand store (`store.ts`) — single store, no slices
- CSS: Tailwind 4 utility classes only (no CSS modules, no styled-components)
- No test framework installed — no vitest, jest, or testing-library
- React 19 patterns (no class components)
- Tauri IPC via `@tauri-apps/api` — invoke commands defined in `src-tauri/src/commands/`
