import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Fragment } from '@tiptap/pm/model';
import type { Node, Schema } from '@tiptap/pm/model';

interface HardBreakPluginConfig {
  name: string;
  regex: RegExp;
  build: (
    schema: Schema,
    match: RegExpMatchArray,
  ) => { content: Node | Fragment; cursorOffset: number };
}

/**
 * Factory for ProseMirror plugins that convert markdown block markers typed
 * after a hardBreak (Enter key) into proper block nodes.
 *
 * Problem: Pressing Enter in a top-level paragraph inserts a hardBreak (<br>),
 * which markdown serialises as "  \n" (line break within the same paragraph).
 * When the user then types a block marker like "> " or "## ", ProseMirror's
 * built-in input rules don't fire because they check for paragraph-start —
 * the marker text is preceded by a hardBreak in the same paragraph.
 *
 * Solution: This factory returns a Plugin that watches appendTransaction for
 * markers matching `regex` following a hardBreak, then delegates node
 * construction to `build()`.
 */
export function createHardBreakPlugin(config: HardBreakPluginConfig): Plugin {
  const { name, regex, build } = config;

  return new Plugin({
    key: new PluginKey(name),

    appendTransaction: (_transactions, _oldState, newState) => {
      if (_transactions.some((tr) => tr.getMeta(name))) return null;

      const { doc, selection } = newState;
      const { $from } = selection;

      // Only handle cursor at end of a top-level paragraph
      if ($from.depth !== 1) return null;
      if ($from.parent.type.name !== 'paragraph') return null;
      if ($from.pos !== $from.end()) return null;

      const para = $from.parent;
      const paraStart = $from.start();

      // Find the last hardBreak in the paragraph
      let hardBreakIndex = -1;
      for (let i = 0; i < para.childCount; i++) {
        if (para.child(i).type.name === 'hardBreak') {
          hardBreakIndex = i;
        }
      }
      if (hardBreakIndex === -1) return null;

      // Collect text after the hardBreak (contiguous text nodes)
      let textAfter = '';
      for (let j = hardBreakIndex + 1; j < para.childCount; j++) {
        const child = para.child(j);
        if (child.isText) {
          textAfter += child.text || '';
        } else {
          break;
        }
      }
      if (!textAfter) return null;

      const match = textAfter.match(regex);
      if (!match) return null;

      // Calculate hardBreak position in the document
      let offset = 0;
      for (let i = 0; i < hardBreakIndex; i++) {
        offset += para.child(i).nodeSize;
      }
      const hardBreakPos = paraStart + offset;

      const { content, cursorOffset } = build(doc.type.schema, match);

      // Delete from hardBreak to end of paragraph, replace with built content
      const tr = newState.tr;
      const fragment = content instanceof Fragment ? content : Fragment.from(content);
      tr.replaceWith(hardBreakPos, $from.end(), fragment);
      tr.setSelection(TextSelection.create(tr.doc, hardBreakPos + cursorOffset));
      tr.setMeta(name, true);

      return tr;
    },
  });
}
