import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';

/**
 * ProseMirror plugin that converts heading markers typed after a hardBreak
 * (Enter key) into proper heading nodes.
 *
 * Problem: Pressing Enter in a top-level paragraph inserts a hardBreak (<br>),
 * which markdown serialises as "  \n" (line break within the same paragraph).
 * When the user then types a heading marker like "## ", ProseMirror's built-in
 * input rules don't fire because they check for paragraph-start — the marker
 * text is preceded by a hardBreak in the same paragraph.
 *
 * Solution: This plugin watches appendTransaction for heading markers following
 * a hardBreak and manually performs the conversion.
 */
export const HeadingAfterHardBreak = Extension.create({
  name: 'headingAfterHardBreak',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('headingAfterHardBreak'),

        appendTransaction: (_transactions, _oldState, newState) => {
          // Avoid re-triggering on our own transformations
          if (_transactions.some((tr) => tr.getMeta('headingAfterHardBreak'))) {
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

          // Check if text matches heading pattern (# through ######)
          // Must be at the start of the text after hardBreak
          const headingMatch = textAfter.match(/^(#{1,6})\s(.*)$/);
          if (!headingMatch) return null;

          const level = headingMatch[1].length; // 1-6
          const afterText = headingMatch[2]; // text after heading marker

          // Calculate hardBreak position in the document
          let offset = 0;
          for (let i = 0; i < hardBreakIndex; i++) {
            offset += para.child(i).nodeSize;
          }
          const hardBreakPos = paraStart + offset;

          // Build the heading node
          const schema = doc.type.schema;
          const headingContent = afterText
            ? schema.nodes.heading.create(
                { level },
                schema.text(afterText),
              )
            : schema.nodes.heading.create({ level });

          // Delete from hardBreak to end of paragraph, replace with heading node
          const tr = newState.tr;
          tr.replaceWith(hardBreakPos, $from.end(), headingContent);

          // Set cursor inside the heading node
          // Heading structure: [heading](1) + textContent
          // Content inside heading starts at hardBreakPos + 1
          const cursorPos =
            hardBreakPos + 1 + (afterText ? afterText.length : 0);
          tr.setSelection(TextSelection.create(tr.doc, cursorPos));
          tr.setMeta('headingAfterHardBreak', true);

          return tr;
        },
      }),
    ];
  },
});
