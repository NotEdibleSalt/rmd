import { Extension } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';

/**
 * ProseMirror plugin that converts horizontal rule markers typed after a
 * hardBreak (Enter key) into a proper horizontalRule node.
 *
 * Problem: Pressing Enter in a top-level paragraph inserts a hardBreak (<br>),
 * which markdown serialises as "  \n" (line break within the same paragraph).
 * When the user then types a horizontal rule marker like "---", ProseMirror's
 * built-in input rules don't fire because they check for paragraph-start —
 * the marker text is preceded by a hardBreak in the same paragraph.
 *
 * Solution: This plugin watches appendTransaction for "---", "***", or "___"
 * following a hardBreak and manually performs the conversion.
 */
export const HorizontalRuleAfterHardBreak = Extension.create({
  name: 'horizontalRuleAfterHardBreak',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('horizontalRuleAfterHardBreak'),

        appendTransaction: (_transactions, _oldState, newState) => {
          // Avoid re-triggering on our own transformations
          if (_transactions.some((tr) => tr.getMeta('horizontalRuleAfterHardBreak'))) {
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

          // Check if text matches horizontal rule patterns: ---, ***, ___
          const hrMatch = textAfter.match(/^(---|\*\*\*|___)$/);
          if (!hrMatch) return null;

          // Calculate hardBreak position in the document
          let offset = 0;
          for (let i = 0; i < hardBreakIndex; i++) {
            offset += para.child(i).nodeSize;
          }
          const hardBreakPos = paraStart + offset;

          // Build the horizontalRule node + a new empty paragraph for cursor placement
          const schema = doc.type.schema;
          const hr = schema.nodes.horizontalRule.create();
          const newPara = schema.nodes.paragraph.create();

          // Delete from hardBreak to end of paragraph, replace with hr + empty paragraph
          const tr = newState.tr;
          tr.replaceWith(hardBreakPos, $from.end(), Fragment.fromArray([hr, newPara]));

          // Set cursor inside the new empty paragraph
          // Structure: [hr](1) + [paragraph](1)
          // Content inside paragraph starts at hardBreakPos + 2
          tr.setSelection(TextSelection.create(tr.doc, hardBreakPos + 2));
          tr.setMeta('horizontalRuleAfterHardBreak', true);

          return tr;
        },
      }),
    ];
  },
});
