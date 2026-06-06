import { useEffect, useRef } from 'react';
import { useEditorStore, selectSource } from './store';
import type { CompletionContext } from '@codemirror/autocomplete';

export function SourceEditor() {
  const editorRef = useRef<HTMLDivElement>(null);
  const editorViewRef = useRef<any>(null);
  const source = useEditorStore(selectSource);
  const setSource = useEditorStore((s) => s.setSource);
  const config = useEditorStore((s) => s.config);
  const theme = useEditorStore((s) => s.theme);
  const lastSyncedSource = useRef(source);

  // Cache dynamically imported modules for reconfiguration
  const modulesRef = useRef<{
    EditorView: typeof import('codemirror')['EditorView'];
    oneDark: typeof import('@codemirror/theme-one-dark')['oneDark'];
    lineNumbers: typeof import('@codemirror/view')['lineNumbers'];
  } | null>(null);

  const getFontFamily = () => {
    const ff = config.font_family;
    if (!ff || ff === 'system-ui') {
      return "'JetBrains Mono', 'Fira Code', 'Consolas', monospace";
    }
    return ff;
  };

  useEffect(() => {
    async function initEditor() {
      const el = editorRef.current;
      if (!el || editorViewRef.current) return;

      const { EditorView, basicSetup } = await import('codemirror');
      const { EditorState, Compartment } = await import('@codemirror/state');
      const { markdown } = await import('@codemirror/lang-markdown');
      const { oneDark } = await import('@codemirror/theme-one-dark');
      const { lineNumbers } = await import('@codemirror/view');
      const { autocompletion } = await import('@codemirror/autocomplete');

      // Cache modules for later reconfiguration
      modulesRef.current = { EditorView, oneDark, lineNumbers };

      // Create compartments for dynamic reconfiguration
      const themeCompartment = new Compartment();
      const fontCompartment = new Compartment();
      const lineNumbersCompartment = new Compartment();
      const wrapCompartment = new Compartment();
      const spellcheckCompartment = new Compartment();

      // Light theme using CSS variables from App.css
      const lightTheme = EditorView.theme({
        '&': { backgroundColor: 'transparent', height: '100%' },
        '.cm-content': { caretColor: 'var(--text-primary)', color: 'var(--text-primary)' },
        '.cm-gutters': {
          backgroundColor: 'transparent',
          borderRight: '1px solid var(--border-color)',
          color: 'var(--text-muted)',
        },
        '.cm-activeLineGutter': { backgroundColor: 'var(--bg-tertiary)' },
      });

      const isDark = theme === 'dark';

      // Wiki link completion: triggers on `[[` and suggests workspace files.
      // Source mode just inserts `[[Page]]` text — the WikiLinkMark on the
      // WYSIWYG side handles mark decoration when the user switches back.
      const wikiLinkCompletion = (ctx: CompletionContext) => {
        const before = ctx.matchBefore(/\[\[(?!\[)[^\]]*/);
        if (!before) return null;
        // Don't trigger if the cursor is right before ]] (inside an existing
        // wikilink) — inserting `f.name]]` would duplicate the closing brackets.
        const nextChar = ctx.state.sliceDoc(ctx.pos, ctx.pos + 1);
        if (nextChar === ']') return null;
        const query = before.text.slice(2);
        const files = useEditorStore.getState().workspaceIndex.fuzzySearch(query, 10);
        return {
          from: before.from + 2,
          options: files.map((f) => ({
            label: f.name,
            apply: `${f.name}]]`,
            detail: f.path,
          })),
          validFor: /^[^\]]*$/,
        };
      };

      const startState = EditorState.create({
        doc: source,
        extensions: [
          basicSetup,
          markdown(),
          autocompletion({ override: [wikiLinkCompletion] }),
          themeCompartment.of(isDark ? oneDark : lightTheme),
          fontCompartment.of(
            EditorView.theme({
              '.cm-scroller': {
                fontFamily: getFontFamily(),
                fontSize: `${config.editor_font_size}px`,
              },
            })
          ),
          lineNumbersCompartment.of(config.line_numbers ? lineNumbers() : []),
          wrapCompartment.of(config.word_wrap ? EditorView.lineWrapping : []),
          spellcheckCompartment.of(EditorView.contentAttributes.of({ spellcheck: config.spell_check ? "true" : "false" })),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              const md = update.state.doc.toString();
              lastSyncedSource.current = md;
              setSource(md);
            }
          }),
        ],
      });

      const view = new EditorView({ state: startState, parent: el });

      editorViewRef.current = {
        view,
        compartments: {
          themeCompartment,
          fontCompartment,
          lineNumbersCompartment,
          wrapCompartment,
          spellcheckCompartment,
        },
      };
    }

    initEditor();

    return () => {
      if (editorViewRef.current) {
        editorViewRef.current.view.destroy();
        editorViewRef.current = null;
      }
    };
  }, []);

  // Sync external source changes into CodeMirror (e.g. from WYSIWYG mode)
  useEffect(() => {
    const view = editorViewRef.current?.view;
    if (!view) return;
    if (source !== lastSyncedSource.current) {
      const { doc } = view.state;
      if (doc.toString() !== source) {
        lastSyncedSource.current = source;
        view.dispatch({
          changes: { from: 0, to: doc.length, insert: source },
        });
      }
    }
  }, [source]);

  // Reconfigure compartments when settings or theme change
  useEffect(() => {
    const ref = editorViewRef.current;
    const mods = modulesRef.current;
    if (!ref || !mods) return;

    const { view, compartments } = ref;
    const {
      themeCompartment,
      fontCompartment,
      lineNumbersCompartment,
      wrapCompartment,
      spellcheckCompartment,
    } = compartments;
    const { EditorView, oneDark, lineNumbers } = mods;

    const lightTheme = EditorView.theme({
      '&': { backgroundColor: 'transparent', height: '100%' },
      '.cm-content': { caretColor: 'var(--text-primary)', color: 'var(--text-primary)' },
      '.cm-gutters': {
        backgroundColor: 'transparent',
        borderRight: '1px solid var(--border-color)',
        color: 'var(--text-muted)',
      },
      '.cm-activeLineGutter': { backgroundColor: 'var(--bg-tertiary)' },
    });

    const isDark = theme === 'dark';

    view.dispatch({
      effects: [
        themeCompartment.reconfigure(isDark ? oneDark : lightTheme),
        fontCompartment.reconfigure(
          EditorView.theme({
            '.cm-scroller': {
              fontFamily: getFontFamily(),
              fontSize: `${config.editor_font_size}px`,
            },
          })
        ),
        lineNumbersCompartment.reconfigure(config.line_numbers ? lineNumbers() : []),
        wrapCompartment.reconfigure(config.word_wrap ? EditorView.lineWrapping : []),
        spellcheckCompartment.reconfigure(
          EditorView.contentAttributes.of({ spellcheck: config.spell_check ? "true" : "false" })
        ),
      ],
    });
  }, [
    config.line_numbers,
    config.word_wrap,
    config.font_family,
    config.editor_font_size,
    config.spell_check,
    theme,
  ]);

  return <div className="source-editor" ref={editorRef} />;
}
