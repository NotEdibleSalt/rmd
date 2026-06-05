import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';

/**
 * ProseMirror plugin that converts blockquote markers typed after a hardBreak
 * (Enter key) into proper blockquote nodes.
 *
 * Problem: Pressing Enter in a top-level paragraph inserts a hardBreak (<br>),
 * which markdown serialises as "  \n" (line break within the same paragraph).
 * When the user then types a blockquote marker like "> ", ProseMirror's built-in
 * input rules don't fire because they check for paragraph-start — the marker
 * text is preceded by a hardBreak in the same paragraph.
 *
 * Solution: This plugin watches appendTransaction for ">" following a hardBreak
 * and manually performs the conversion.
 */
export const BlockquoteAfterHardBreak = Extension.create({
  name: 'blockquoteAfterHardBreak',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('blockquoteAfterHardBreak'),

        appendTransaction: (_transactions, _oldState, newState) => {
          // Avoid re-triggering on our own transformations
          if (_transactions.some((tr) => tr.getMeta('blockquoteAfterHardBreak'))) {
            return null;
          }

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

          // Check if text matches blockquote pattern: "> " optionally preceded by whitespace
          const blockquoteMatch = textAfter.match(/^\s*>\s(.*)$/);
          if (!blockquoteMatch) return null;

          const afterText = blockquoteMatch[1]; // text after "> "

          // Calculate hardBreak position in the document
          let offset = 0;
          for (let i = 0; i < hardBreakIndex; i++) {
            offset += para.child(i).nodeSize;
          }
          const hardBreakPos = paraStart + offset;

          // Build the blockquote node structure
          const schema = doc.type.schema;
          const paraContent = afterText
            ? schema.nodes.paragraph.create(null, schema.text(afterText))
            : schema.nodes.paragraph.create();
          const blockquote = schema.nodes.blockquote.create(null, paraContent);

          // Delete from hardBreak to end of paragraph, replace with blockquote
          const tr = newState.tr;
          tr.replaceWith(hardBreakPos, $from.end(), blockquote);

          // Set cursor inside the blockquote's paragraph
          // Structure: [blockquote](1) + [paragraph](1) + textContent
          // Content inside paragraph starts at hardBreakPos + 2
          const cursorPos =
            hardBreakPos + 2 + (afterText ? afterText.length : 0);
          tr.setSelection(TextSelection.create(tr.doc, cursorPos));
          tr.setMeta('blockquoteAfterHardBreak', true);

          return tr;
        },
      }),
    ];
  },
});
