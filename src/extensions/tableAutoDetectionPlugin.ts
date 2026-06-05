import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import {
  detectTableFromPos,
  detectTableAtState,
  detectTableFromText,
  buildTableFromData,
  insertTableAtPos,
} from '../utils/tableDetection';
import { getEditorInstance } from '../editor-ref';

/**
 * ProseMirror Plugin that auto-detects GFM table syntax and converts it into
 * a rendered TipTap Table node.
 *
 * Three trigger paths:
 *   1. **Keyboard typing** (`handleKeyDown`): user types `|` at end of a
 *      top-level paragraph → auto-pair + detect + convert.
 *   2. **Paste** (`handlePaste`): clipboard text is a complete GFM table →
 *      insert as table node at cursor.
 *   3. **Any doc change** (`appendTransaction`): covers delete, programmatic
 *      changes, etc. Skips undo/redo to avoid breaking the undo stack.
 */
export const TableAutoDetection = Extension.create({
  name: 'tableAutoDetection',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('tableAutoDetection'),
        props: {
          handleKeyDown: (_view, event) => {
            if (event.key === '|' && !event.metaKey && !event.ctrlKey && !event.altKey) {
              event.preventDefault();
              const editor = getEditorInstance();
              if (!editor) return true;

              const { from } = editor.state.selection;
              const $pos = editor.state.doc.resolve(from);

              if (
                $pos.depth === 1 &&
                $pos.parent.type.name === 'paragraph' &&
                $pos.parentOffset === $pos.parent.content.size
              ) {
                // At end of a top-level paragraph: insert single pipe and detect table
                editor.chain().focus().insertContent('|').run();
                const detection = detectTableFromPos(editor);
                if (detection) {
                  insertTableAtPos(editor, detection);
                }
              } else {
                // Auto-pair: insert || and place cursor between
                editor.chain().focus().insertContent('||').setTextSelection(from + 1).run();
              }
              return true;
            }
            return false;
          },

          handlePaste: (view, event) => {
            const text = event.clipboardData?.getData('text/plain');
            if (!text) return false;

            const tableData = detectTableFromText(text);
            if (!tableData) return false;

            const table = buildTableFromData(
              view.state.schema,
              tableData.headers,
              tableData.rows,
            );
            const { from, to } = view.state.selection;
            view.dispatch(view.state.tr.replaceWith(from, to, table));
            return true;
          },
        },

        // Catch-all: reacts to any doc change (delete, programmatic, etc.)
        // that assembles a GFM table at the cursor paragraph.
        // **Skips undo/redo** to avoid re-converting the paragraph every time
        // the user tries to undo a table conversion.
        appendTransaction: (transactions, _oldState, newState) => {
          if (!transactions.some(tr => tr.docChanged)) return null;

          // Skip undo/redo — otherwise the user can never get back to the
          // paragraph form after a conversion.
          if (transactions.some(tr => {
            const historyMeta = tr.getMeta('history$');
            return historyMeta?.undo || historyMeta?.redo;
          })) return null;

          const detection = detectTableAtState(newState);
          if (!detection) return null;

          const table = buildTableFromData(
            newState.schema,
            detection.headers,
            detection.rows,
          );
          return newState.tr.replaceWith(detection.from, detection.to, table);
        },
      }),
    ];
  },
});
