import { useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent, mergeAttributes, ReactNodeViewRenderer, type Editor } from '@tiptap/react';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { TableBlock } from './extensions/tableBlock';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Placeholder from '@tiptap/extension-placeholder';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';
import { setEditorInstance, getEditorInstance } from './editor-ref';
import { useEditorStore, selectSource, ensureImageSaveDir } from './store';
import { resolveAbsolutePath } from './utils/image';
import { extractPastedCode } from './utils/langDetect';
import { MermaidNode } from './extensions/MermaidNode';
import { TableAutoDetection } from './extensions/tableAutoDetectionPlugin';
import { BacktickSelectorExtension } from './extensions/backtickSelectorPlugin';
import { BacktickSelector } from './extensions/BacktickSelector';
import { CodeBlockToolbar } from './extensions/CodeBlockToolbar';
import { WikiLinkMark } from './extensions/WikiLinkMark';
import { WikiLinkAutocompletePlugin } from './extensions/wikiLinkAutocompletePlugin';
import { MarkdownLinkInputRule } from './extensions/MarkdownLinkInputRule';
import { ListAfterHardBreak } from './extensions/ListAfterHardBreak';
import { HeadingAfterHardBreak } from './extensions/HeadingAfterHardBreak';
import { BlockquoteAfterHardBreak } from './extensions/BlockquoteAfterHardBreak';
import { HorizontalRuleAfterHardBreak } from './extensions/HorizontalRuleAfterHardBreak';
import { MathBlock } from './extensions/MathBlock';
import { MathInline } from './extensions/MathInline';
import { WikiLinkAutocomplete } from './extensions/WikiLinkAutocomplete';
import { ImageResizeView } from './extensions/ImageResizeView';
import { convertFileSrc } from '@tauri-apps/api/core';
import { invoke } from '@tauri-apps/api/core';
import { writeFile, mkdir } from '@tauri-apps/plugin-fs';

const lowlight = createLowlight(common);

/* ─────────────── Custom Image extension ───────────────
 * Stores the portable markdown path in `data-markdown-src`
 * and the display-ready asset URL in `src` (via Tauri convertFileSrc).
 * Markdown serialization always uses `data-markdown-src`.
 */
const LocalImage = Image.extend({
  addAttributes() {
    return {
      src: { default: null },
      alt: { default: null },
      title: { default: null },
      'data-markdown-src': { default: null },
      width: { default: null },
    };
  },
  renderHTML({ HTMLAttributes }) {
    // Strip internal attribute from rendered HTML
    const { 'data-markdown-src': _mdSrc, ...attrs } = HTMLAttributes;
    return ['img', attrs];
  },
  parseHTML() {
    return [
      {
        tag: 'img[src]',
        getAttrs: (el) => {
          if (typeof el === 'string') return {};
          const img = el as HTMLImageElement;
          return {
            src: img.getAttribute('src'),
            'data-markdown-src': img.getAttribute('data-markdown-src'),
            width: img.getAttribute('width'),
          };
        },
      },
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageResizeView);
  },
});

/* ─────────────── Resolve local image paths to Tauri asset URLs ─────────────── */

/** Scan editor for image nodes whose src is a relative file path and resolve to Tauri asset URLs */
function resolveImageNodesInEditor(editor: Editor) {
  const currentDir = useEditorStore.getState().currentDir;
  const images: { pos: number; attrs: Record<string, unknown> }[] = [];

  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'image') {
      const src = node.attrs.src as string;
      if (src && !src.startsWith('data:') && !src.startsWith('http://') && !src.startsWith('https://')) {
        images.push({ pos, attrs: { ...node.attrs } });
      }
    }
  });

  for (const { pos, attrs } of images) {
    try {
      const absPath = resolveAbsolutePath(attrs.src as string, currentDir);
      if (absPath === attrs.src) continue;
      const assetUrl = convertFileSrc(absPath);
      editor.view.dispatch(
        editor.state.tr.setNodeMarkup(pos, undefined, {
          ...attrs,
          src: assetUrl,
          'data-markdown-src': attrs.src,
        })
      );
    } catch (e) {
      console.error('Failed to resolve image node:', (attrs.src as string) || '(empty)', e);
    }
  }
}

/* ─────────────── Component ─────────────── */

export function WysiwygEditor() {
  const source = useEditorStore(selectSource);
  const theme = useEditorStore((s) => s.theme);
  const setSource = useEditorStore((s) => s.setSource);
  const config = useEditorStore((s) => s.config);
  const currentDir = useEditorStore((s) => s.currentDir);
  const isExternalUpdate = useRef(false);
  const lastSyncedSource = useRef(source);
  const imageInsertData = useEditorStore((s) => s.imageInsertData);
  const clearImageInsert = useEditorStore((s) => s.clearImageInsert);
  const insertImageFromPath = useEditorStore((s) => s.insertImageFromPath);

  // Search highlight state — shared with the ProseMirror plugin via ref
  const searchRef = useRef({ query: '', caseSensitive: false });
  const findQuery = useEditorStore((s) => s.findQuery);
  const findReplaceOpen = useEditorStore((s) => s.findReplaceOpen);
  const findCaseSensitive = useEditorStore((s) => s.findCaseSensitive);

  // Link edit popover state
  const [linkEdit, setLinkEdit] = useState<{
    href: string;
    pos: { from: number; to: number };
    coords: { left: number; top: number };
  } | null>(null);
  const linkEditRef = useRef<HTMLDivElement>(null);

  // Code block toolbar state
  const [codeBlockToolbar, setCodeBlockToolbar] = useState<{
    from: number; to: number;
    language: string;
    coords: { left: number; top: number };
  } | null>(null);
  const codeBlockToolbarRef = useRef<HTMLDivElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4, 5, 6] },
        codeBlock: false,
        link: false,
      }),
      (Markdown as any).configure({
        markedOptions: { gfm: true },
        markdownSerializer: {
          nodes: {
            image: (state: any, node: any) => {
              const src = node.attrs['data-markdown-src'] || node.attrs.src;
              const alt = node.attrs.alt || '';
              const width = node.attrs.width;
              if (width) {
                // Use inline HTML when width is set (standard markdown doesn't have width syntax)
                state.write(`<img src="${src}" alt="${alt}" width="${width}">`);
              } else {
                state.write('![');
                state.write(alt);
                state.write('](');
                state.write(src);
                state.write(')');
              }
            },
            mermaid: (state: any, node: any) => {
              state.write('```mermaid\n');
              state.text(node.attrs.content, false);
              state.ensureNewLine();
              state.write('```');
              state.closeBlock(node);
            },
          },
        },
      }),
      TableBlock.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      LocalImage,
      Link.configure({ openOnClick: false }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: '开始写作...' }),
      CodeBlockLowlight.extend({
        renderHTML({ node, HTMLAttributes }) {
          return [
            'pre',
            mergeAttributes(
              this.options.HTMLAttributes,
              HTMLAttributes,
              { 'data-language': node.attrs.language || null },
            ),
            [
              'code',
              { class: node.attrs.language ? this.options.languageClassPrefix + node.attrs.language : null },
              0,
            ],
          ];
        },
      }).configure({ lowlight }),
      MermaidNode,
      BacktickSelectorExtension,
      TableAutoDetection,
      WikiLinkMark,
      WikiLinkAutocompletePlugin,
      MarkdownLinkInputRule,
      ListAfterHardBreak,
      HeadingAfterHardBreak,
      BlockquoteAfterHardBreak,
      HorizontalRuleAfterHardBreak,
      MathBlock,
      MathInline,
      // ProseMirror plugin: highlight find-and-replace matches
      new Plugin({
        key: new PluginKey('search'),
        state: {
          init() { return DecorationSet.empty; },
          apply(tr, old) {
            if (!tr.docChanged && !tr.getMeta('search')) return old;
            const { query, caseSensitive } = searchRef.current;
            if (!query) return DecorationSet.empty;
            const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const flags = caseSensitive ? 'g' : 'gi';
            const regex = new RegExp(escaped, flags);
            const decorations: Decoration[] = [];
            tr.doc.descendants((node: any, pos: number) => {
              if (node.isText) {
                const text = node.text || '';
                let m: RegExpExecArray | null;
                while ((m = regex.exec(text)) !== null) {
                  decorations.push(Decoration.inline(pos + m.index, pos + m.index + m[0].length, { class: 'search-highlight' }));
                }
              }
            });
            return DecorationSet.create(tr.doc, decorations);
          },
        },
        props: {
          decorations(state) { return this.getState(state); },
        },
      }),
    ],
    content: source,
    contentType: 'markdown' as any,
    onUpdate: ({ editor }) => {
      if (isExternalUpdate.current) return;
      // Strip empty block nodes from the content before serialization.
      // Pressing Enter in ProseMirror creates new paragraph nodes; returning to
      // an empty paragraph and pressing Enter again creates more empty paragraphs.
      // These are structural artifacts — they serialize through the Document
      // renderMarkdown as "\n\n" joiners around empty strings, producing extra
      // blank lines in the markdown output.
      // Additionally, paragraphs that contain only empty text nodes (e.g.
      // {type:"text", text:""}) also produce empty serialization, so we
      // filter those as well.
      const json = editor.getJSON();
      if (json.content) {
        json.content = json.content.filter((node: any) => {
          // Keep non-paragraph nodes untouched
          if (node.type !== 'paragraph') return true;
          // Remove paragraphs with no content at all
          if (!node.content || node.content.length === 0) return false;
          // Remove paragraphs whose content is only empty/whitespace text nodes
          const allEmptyText = node.content.every(
            (child: any) => child.type === 'text' && (!child.text || child.text.trim() === '')
          );
          return !allEmptyText;
        });
      }
      let md = (editor.storage as any).markdown?.manager?.serialize(json) ?? editor.getMarkdown();
      // Safe normalization: strip leading/trailing newlines.
      // Leading/trailing newlines have no semantic meaning in markdown but would
      // visually appear as extra blank lines at the top/bottom of the source editor.
      // We do NOT collapse 3+ newlines in the middle (would corrupt code blocks).
      md = md.replace(/\r\n/g, '\n').replace(/^\n+/, '').replace(/\n+$/, '');
      if (md !== lastSyncedSource.current) {
        lastSyncedSource.current = md;
        // Defer to avoid flushSync warning when React is in commit phase
        // (e.g. when setContent is called inside a useEffect).
        setTimeout(() => setSource(md), 0);
      }
    },
    editorProps: {
      attributes: {
        class: 'wysiwyg-content',
      },
      handleKeyDown: (_view, event) => {
        // Ctrl+Shift+T / Cmd+Shift+T → insert 3×3 table (must precede Enter check)
        if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === 'T') {
          event.preventDefault();
          const editor = getEditorInstance();
          if (editor) {
            editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
          }
          return true;
        }
        // Enter in a top-level paragraph → insert <br> (hardBreak).
        // Markdown serializes <br> as "  \n" (two spaces + newline) — a line
        // break within the same paragraph, not a blank line.
        // List conversion after Enter is handled by ListAfterHardBreak plugin
        // (see src/extensions/ListAfterHardBreak.ts).
        // Shift+Enter splits into a new paragraph (default behavior).
        if (event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
          const { $from } = _view.state.selection;
          if ($from.depth === 1 && $from.parent.type.name === 'paragraph') {
            event.preventDefault();
            _view.dispatch(
              _view.state.tr.replaceSelectionWith(
                _view.state.schema.nodes.hardBreak.create()
              )
            );
            return true;
          }
        }
        // Auto-pair | + GFM table detection is handled by TableAutoDetection plugin.
        // (keep this slot reserved for future key handlers)
        return false;
      },
      handleClick: (view, pos, _event) => {
        const $pos = view.state.doc.resolve(pos);
        let wikiMark = $pos.marks().find(m => m.type.name === 'wikiLink');
        // When the click falls on the boundary right before the closing
        // `]]` (common when the user clicks near the right edge of the
        // displayed wikilink), $pos.marks() returns empty because the
        // wikiLink mark is on the display text node, not on `]]`.  Check
        // one position back as a fallback.
        if (!wikiMark && pos > 0) {
          const $prev = view.state.doc.resolve(pos - 1);
          wikiMark = $prev.marks().find(m => m.type.name === 'wikiLink');
        }
        if (wikiMark) {
          _event.preventDefault();
          const target = wikiMark.attrs.target as string;
          const missing = wikiMark.attrs.missing as boolean;
          if (missing) {
            useEditorStore.getState().promptCreateWikiLink(target);
          } else {
            useEditorStore.getState().navigateToWikiLink(target);
          }
          return true;
        }
        // Detect click on link mark → show link edit popover
        const linkMark = $pos.marks().find(m => m.type.name === 'link');
        if (linkMark) {
          const href = linkMark.attrs.href as string;
          // Use ProseMirror's textBetween to get the link text range
          const linkType = view.state.schema.marks.link;
          const { doc } = view.state;
          // Walk backward to find link start
          let from = pos;
          for (let i = pos - 1; i >= 0; i--) {
            const node = doc.nodeAt(i);
            if (!node || !node.marks.some(m => m.type === linkType)) { from = i + 1; break; }
            if (i === 0) { from = 0; break; }
          }
          // Walk forward to find link end
          let to = pos;
          for (let i = pos; i < doc.content.size; i++) {
            const node = doc.nodeAt(i);
            if (!node || !node.marks.some(m => m.type === linkType)) { to = i; break; }
            if (i === doc.content.size - 1) { to = doc.content.size; break; }
          }
          const start = view.coordsAtPos(from);
          const end = view.coordsAtPos(to);
          if (start && end) {
            setLinkEdit({
              href,
              pos: { from, to },
              coords: {
                left: (start.left + end.left) / 2,
                top: start.top - 8,
              },
            });
          }
          return true;
        }
        // Detect click on code block node → show language toolbar
        const $codePos = view.state.doc.resolve(pos);
        const parent = $codePos.parent;
        if (parent.type.name === 'codeBlock') {
          _event.preventDefault();
          const start = view.coordsAtPos($codePos.before() + 1);
          if (start) {
            setCodeBlockToolbar({
              from: $codePos.before() + 1,
              to: $codePos.after() - 1,
              language: parent.attrs.language as string || '',
              coords: {
                left: start.left,
                top: start.top - 8,
              },
            });
          }
          return true;
        }
        return false;
      },
      handleDrop: (_view, event, _slice, moved) => {
        if (!moved && event.dataTransfer?.files?.length) {
          handleImageFileList(event.dataTransfer.files, currentDir, insertImageFromPath);
          return true;
        }
        return false;
      },
      handlePaste: (_view, event) => {
        // Auto-detect pasted code blocks
        const text = event.clipboardData?.getData('text');
        if (text) {
          const result = extractPastedCode(text);
          if (result && result.language) {
            const editor = getEditorInstance();
            const isFenced = /^```/.test(text);
            if ((isFenced || result.code.includes('\n')) && editor) {
              event.preventDefault();
              editor.chain().focus().setCodeBlock({ language: result.language }).insertContent(result.code).run();
              return true;
            }
          }
        }

        const items = event.clipboardData?.items;
        if (items) {
          for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.type.startsWith('image/')) {
              const file = item.getAsFile();
              if (file) {
                handleImageFileBlob(file, currentDir, insertImageFromPath);
                return true;
              }
            }
          }
        }
        return false;
      },
    },
  });

  // Register editor instance for toolbar access
  useEffect(() => {
    setEditorInstance(editor);
    return () => setEditorInstance(null);
  }, [editor]);

  // Find & Replace: update search highlight decorations
  useEffect(() => {
    searchRef.current = { query: findReplaceOpen ? findQuery : '', caseSensitive: findCaseSensitive };
    if (editor) {
      // Force the search plugin to re-evaluate decorations
      editor.view.dispatch(editor.state.tr.setMeta('search', true));
    }
  }, [findQuery, findReplaceOpen, findCaseSensitive, editor]);

  // Resolve existing image references after editor mounts
  useEffect(() => {
    if (!editor) return;
    const timer = setTimeout(() => resolveImageNodesInEditor(editor), 100);
    return () => clearTimeout(timer);
  }, [editor]);

  // External sync: when store.source changes, update editor
  useEffect(() => {
    if (!editor) return;
    if (source !== lastSyncedSource.current) {
      lastSyncedSource.current = source;
      // Defer setContent out of React's commit phase to avoid flushSync warning.
      setTimeout(() => {
        isExternalUpdate.current = true;
        editor.commands.setContent(source, { contentType: 'markdown', emitUpdate: false } as any);
        // Resolve images in the newly loaded content
        setTimeout(() => resolveImageNodesInEditor(editor), 50);
        requestAnimationFrame(() => {
          isExternalUpdate.current = false;
        });
        // Force lowlight to recompute decorations after content loads.
        // Normally setContent triggers lowlight's condition 3 (step encapsulates
        // node), but dispatch an explicit touch transaction as a safeguard.
        requestAnimationFrame(() => {
          if (!editor || !config.syntax_hint) return;
          const tr = editor.state.tr.setMeta('addToHistory', false);
          let touched = false;
          editor.state.doc.descendants((node, pos) => {
            if (node.type.name === 'codeBlock') {
              tr.replaceWith(pos, pos + node.nodeSize, node);
              touched = true;
              return false; // one touch is enough to trigger full recomputation
            }
          });
          if (touched) editor.view.dispatch(tr);
        });
      }, 0);
    }
  }, [source, editor]);

  // Handle image insertion from store
  useEffect(() => {
    if (!editor || !imageInsertData) return;
    const { markdownSrc, dataUrl } = imageInsertData;
    clearImageInsert();
    // Defer editor dispatch out of React's commit phase
    setTimeout(() => {
      editor.chain().focus()
        .setImage({ src: dataUrl })
        .updateAttributes('image', { 'data-markdown-src': markdownSrc })
        .run();
    }, 0);
  }, [imageInsertData, editor, clearImageInsert]);

  // Theme sync
  useEffect(() => {
    if (!editor) return;
    editor.view.dom.setAttribute('data-theme', theme);
    const editorEl = editor.view.dom.closest('.wysiwyg-editor') as HTMLElement | null;
    if (editorEl) editorEl.dataset.theme = theme;
  }, [theme, editor]);

  // Close link edit popover on outside click
  useEffect(() => {
    if (!linkEdit) return;
    const handler = (e: MouseEvent) => {
      if (linkEditRef.current && !linkEditRef.current.contains(e.target as Node)) {
        setLinkEdit(null);
      }
    };
    // Delay to avoid the same click that opened the popover from closing it
    const timer = setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => { clearTimeout(timer); document.removeEventListener('mousedown', handler); };
  }, [linkEdit]);

  // Close code block toolbar on outside click
  useEffect(() => {
    if (!codeBlockToolbar) return;
    const handler = (e: MouseEvent) => {
      if (codeBlockToolbarRef.current && !codeBlockToolbarRef.current.contains(e.target as Node)) {
        setCodeBlockToolbar(null);
      }
    };
    const timer = setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => { clearTimeout(timer); document.removeEventListener('mousedown', handler); };
  }, [codeBlockToolbar]);

  // Font size
  useEffect(() => {
    if (!editor) return;
    editor.view.dom.style.fontSize = `${config.preview_font_size}px`;
  }, [config.preview_font_size, editor]);

  // Line height
  useEffect(() => {
    if (!editor) return;
    editor.view.dom.style.lineHeight = `${config.line_height}`;
  }, [config.line_height, editor]);

  // syntax_hint: toggle code block highlighting via data attribute + CSS
  useEffect(() => {
    if (!editor) return;
    editor.view.dom.setAttribute('data-syntax-hint', String(config.syntax_hint));
  }, [config.syntax_hint, editor]);

  // spell_check: toggle native browser spellcheck (backed by OS spellchecker)
  useEffect(() => {
    if (!editor) return;
    editor.view.dom.setAttribute('spellcheck', String(config.spell_check));
  }, [config.spell_check, editor]);

  // font_family: apply to ProseMirror content area
  useEffect(() => {
    if (!editor) return;
    editor.view.dom.style.fontFamily = config.font_family === 'system-ui' ? '' : config.font_family;
  }, [config.font_family, editor]);

  if (!editor) return null;

  return (
    <div className="wysiwyg-editor" data-theme={theme}>
      <EditorContent editor={editor} className="wysiwyg-editor-content" />
      <BubbleMenu editor={editor} className="bubble-menu" updateDelay={150}>
        <div className="bubble-menu-group">
          <button type="button" onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            className={`bubble-menu-btn ${editor.isActive('heading', { level: 1 }) ? 'active' : ''}`}
            data-tooltip="标题 1">H1</button>
          <button type="button" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            className={`bubble-menu-btn ${editor.isActive('heading', { level: 2 }) ? 'active' : ''}`}
            data-tooltip="标题 2">H2</button>
          <button type="button" onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            className={`bubble-menu-btn ${editor.isActive('heading', { level: 3 }) ? 'active' : ''}`}
            data-tooltip="标题 3">H3</button>
        </div>
        <div className="bubble-menu-divider" />
        <div className="bubble-menu-group">
          <button type="button" onClick={() => editor.chain().focus().toggleBold().run()}
            className={`bubble-menu-btn ${editor.isActive('bold') ? 'active' : ''}`}
            data-tooltip="粗体 (Ctrl+B)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M15.6 10.79c.97-.67 1.65-1.77 1.65-2.79 0-2.26-1.75-4-4-4H7v14h7.04c2.09 0 3.71-1.7 3.71-3.79 0-1.52-.86-2.82-2.15-3.42zM10 6.5h3c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5h-3v-3zm3.5 9H10v-3h3.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5z"/></svg>
          </button>
          <button type="button" onClick={() => editor.chain().focus().toggleItalic().run()}
            className={`bubble-menu-btn ${editor.isActive('italic') ? 'active' : ''}`}
            data-tooltip="斜体 (Ctrl+I)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M10 4v3h2.21l-3.42 8H6v3h8v-3h-2.21l3.42-8H18V4z"/></svg>
          </button>
          <button type="button" onClick={() => editor.chain().focus().toggleStrike().run()}
            className={`bubble-menu-btn ${editor.isActive('strike') ? 'active' : ''}`}
            data-tooltip="删除线">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 12h12M12 5v14"/></svg>
          </button>
          <button type="button" onClick={() => editor.chain().focus().toggleCode().run()}
            className={`bubble-menu-btn ${editor.isActive('code') ? 'active' : ''}`}
            data-tooltip="行内代码">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
          </button>
        </div>
        <div className="bubble-menu-divider" />
        <div className="bubble-menu-group">
          <button type="button"
            onClick={() => {
              const attrs = editor.getAttributes('link');
              if (attrs.href) {
                // Link exists → open for editing
                const { from, to } = editor.state.selection;
                const start = editor.view.coordsAtPos(from);
                const end = editor.view.coordsAtPos(to);
                setLinkEdit({
                  href: attrs.href as string,
                  pos: { from, to },
                  coords: { left: start ? (start.left + (end?.left ?? start.left)) / 2 : 0, top: start?.top ?? 0 },
                });
              } else {
                // No link → prompt via popover at cursor
                const { from } = editor.state.selection;
                const start = editor.view.coordsAtPos(from);
                setLinkEdit({
                  href: 'https://',
                  pos: { from, to: from },
                  coords: { left: start?.left ?? 0, top: start?.top ?? 0 },
                });
              }
            }}
            className={`bubble-menu-btn ${editor.isActive('link') ? 'active' : ''}`}
            data-tooltip="链接">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
          </button>
          <button type="button"
            onClick={() => editor.chain().focus().unsetAllMarks().run()}
            className="bubble-menu-btn"
            data-tooltip="清除格式">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 5l14 14M19 5l-14 14"/></svg>
          </button>
        </div>
      </BubbleMenu>
      {linkEdit && (
        <div
          ref={linkEditRef}
          className="link-edit-popover"
          style={{
            left: linkEdit.coords.left,
            top: linkEdit.coords.top,
          }}
        >
          <div className="link-edit-header">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            <span>链接</span>
          </div>
          <input
            type="text"
            className="link-edit-input"
            value={linkEdit.href}
            placeholder="https://example.com"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                editor.chain().focus().setTextSelection(linkEdit.pos).setLink({ href: linkEdit.href }).run();
                setLinkEdit(null);
              }
              if (e.key === 'Escape') setLinkEdit(null);
            }}
            onChange={(e) => setLinkEdit({ ...linkEdit, href: e.target.value })}
          />
          <div className="link-edit-actions">
            <button type="button" className="link-edit-btn link-edit-btn-save"
              onClick={() => {
                if (linkEdit.href.trim()) {
                  editor.chain().focus().setTextSelection(linkEdit.pos).setLink({ href: linkEdit.href.trim() }).run();
                } else {
                  editor.chain().focus().setTextSelection(linkEdit.pos).unsetLink().run();
                }
                setLinkEdit(null);
              }}>
              {linkEdit.href.trim() ? '应用' : '移除'}
            </button>
            <button type="button" className="link-edit-btn link-edit-btn-remove"
              onClick={() => {
                editor.chain().focus().setTextSelection(linkEdit.pos).unsetLink().run();
                setLinkEdit(null);
              }}>
              删除链接
            </button>
            <button type="button" className="link-edit-btn link-edit-btn-open"
              onClick={() => {
                if (linkEdit.href) {
                  window.open(linkEdit.href, '_blank', 'noopener');
                }
                setLinkEdit(null);
              }}>
              打开
            </button>
          </div>
        </div>
      )}
      <BacktickSelector />
      {codeBlockToolbar && editor && (
        <div ref={codeBlockToolbarRef}>
          <CodeBlockToolbar
            editor={editor}
            language={codeBlockToolbar.language}
            pos={{ from: codeBlockToolbar.from, to: codeBlockToolbar.to }}
            coords={codeBlockToolbar.coords}
            onClose={() => setCodeBlockToolbar(null)}
          />
        </div>
      )}
      <WikiLinkAutocomplete />
    </div>
  );
}

/* ─── helpers for drag-drop / paste images ─── */

async function handleImageFileList(files: FileList, currentDir: string, onInsert: (p: string) => Promise<void>) {
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!file.type.startsWith('image/')) continue;
    await handleImageFileBlob(file, currentDir, onInsert);
  }
}

async function handleImageFileBlob(file: File, _currentDir: string, onInsert: (p: string) => Promise<void>) {
  // 首次弹出目录选择，后续自动复用
  const saveDir = await ensureImageSaveDir();
  if (!saveDir) return;

  // 自动重命名并写入保存目录
  const filename = `${Date.now()}-${file.name}`;
  const destPath = `${saveDir}/${filename}`;

  try {
    await mkdir(saveDir, { recursive: true }).catch(() => {});
    const buf = new Uint8Array(await file.arrayBuffer());
    await writeFile(destPath, buf);
    await onInsert(destPath);
  } catch (e) {
    console.error('Failed to save pasted/dropped image via fs plugin, trying Rust save_image:', e);
    // Fallback: Rust save_image command (uses std::fs::write, bypasses fs plugin scope)
    try {
      const reader = new FileReader();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      // Extract raw base64 (strip "data:image/...;base64," prefix)
      const rawB64 = dataUrl.split(',')[1];
      const savedPath = await invoke<string>('save_image', {
        base64Data: rawB64,
        saveDir,
        filename,
      });
      await onInsert(savedPath);
    } catch (e2) {
      console.error('Rust save_image failed, falling back to inline base64:', e2);
      // Last resort: embed base64 data URL in markdown (may cause 400 on large images)
      try {
        const reader = new FileReader();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
        const { insertImageFromPath } = useEditorStore.getState();
        await insertImageFromPath(dataUrl);
      } catch (e3) {
        console.error('Failed to process image (all methods exhausted):', e3);
      }
    }
  }
}
