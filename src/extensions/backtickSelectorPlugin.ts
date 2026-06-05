import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

// ─── Shared State (bridge between ProseMirror plugin and React component) ───

export interface PendingSelector {
  top: number;
  left: number;
}

let _pending: PendingSelector | null = null;
const _listeners = new Set<() => void>();

export function getPending(): PendingSelector | null {
  return _pending;
}

export function subscribe(fn: () => void): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

function notify() {
  _listeners.forEach((fn) => fn());
}

export function hideSelector() {
  _pending = null;
  notify();
}

// ─── TipTap Extension ───
// Intercepts ``` at paragraph start → shows CodeBlock / Mermaid selector

export const BacktickSelectorExtension = Extension.create({
  name: 'backtickSelector',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('backtickSelector'),
        props: {
          handleDOMEvents: {
            // beforeinput fires before handleTextInput; catches input that
            // composition / dead-key / IME paths might route differently.
            beforeinput: (view, event) => {
              if (!(event instanceof InputEvent)) return false;
              if (event.inputType !== 'insertText' || event.data !== '`') return false;

              const { doc } = view.state;
              const $pos = doc.resolve(view.state.selection.from);
              const node = $pos.parent;

              if (node.type.name !== 'paragraph') return false;

              const textBefore = node.textBetween(0, $pos.parentOffset);
              if (textBefore !== '``') return false;

              const coords = view.coordsAtPos(view.state.selection.from);
              if (!coords) return false;

              _pending = {
                top: coords.bottom + 4,
                left: coords.left,
              };
              notify();

              event.preventDefault();
              return true;
            },
          },
          handleTextInput: (view, from, _to, text) => {
            // Only intercept single backtick input
            if (text !== '`') return false;

            const { doc } = view.state;
            const $pos = doc.resolve(from);
            const node = $pos.parent;

            // Only in paragraphs
            if (node.type.name !== 'paragraph') return false;

            const textBefore = node.textBetween(0, $pos.parentOffset);

            // Must end with "``" before cursor.  We allow non-text nodes
            // (e.g. hardBreaks from the custom Enter handler) before the
            // backticks — only the text content needs to show "``".
            if (!textBefore.endsWith('``')) return false;

            // Show the floating selector below the cursor position.
            // The two backticks stay visible — the click handler will
            // replace the paragraph content with the chosen node.
            const coords = view.coordsAtPos(from);

            _pending = {
              top: coords.bottom + 4,
              left: coords.left,
            };
            notify();

            return true; // prevent the third backtick from being inserted
          },
        },
      }),
    ];
  },
});
