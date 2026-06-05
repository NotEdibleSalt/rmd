import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';

/**
 * ProseMirror plugin that converts list markers typed after a hardBreak
 * (Enter key) into proper list nodes.
 *
 * Problem: Pressing Enter in a top-level paragraph inserts a hardBreak (<br>),
 * which markdown serialises as "  \n" (line break within the same paragraph).
 * When the user then types a list marker like "1. " or "- ", ProseMirror's
 * built-in input rules don't fire because they check for paragraph-start —
 * the marker text is preceded by a hardBreak in the same paragraph.
 *
 * Solution: This plugin watches appendTransaction for list markers following
 * a hardBreak and manually performs the split-and-wrap.
 */
export const ListAfterHardBreak = Extension.create({
  name: 'listAfterHardBreak',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('listAfterHardBreak'),

        appendTransaction: (_transactions, _oldState, newState) => {
          // Avoid re-triggering on our own transformations
          if (_transactions.some((tr) => tr.getMeta('listAfterHardBreak'))) {
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

          // Check if text matches bullet ("- ", "+ ", "* ") or ordered ("1. ") patterns
          const bulletMatch = textAfter.match(/^([-+*])\s(.*)$/);
          const orderedMatch = textAfter.match(/^(\d+)\.\s(.*)$/);
          if (!bulletMatch && !orderedMatch) return null;

          const match = (bulletMatch || orderedMatch)!;
          const afterMarker = match[2]; // remaining text after the marker

          // Check for task list pattern: "- [ ] task" or "- [x] completed"
          // This takes priority over regular bullet lists
          let isTaskItem = false;
          let taskChecked = false;
          let afterText = afterMarker;

          if (bulletMatch) {
            const taskMatch = afterMarker.match(/^\[([ x])\]\s(.*)$/);
            if (taskMatch) {
              isTaskItem = true;
              taskChecked = taskMatch[1] === 'x';
              afterText = taskMatch[2];
            }
          }

          // Calculate hardBreak position in the document
          let offset = 0;
          for (let i = 0; i < hardBreakIndex; i++) {
            offset += para.child(i).nodeSize;
          }
          const hardBreakPos = paraStart + offset;

          // Build the list node structure
          const schema = doc.type.schema;
          const itemContent = afterText
            ? schema.nodes.paragraph.create(null, schema.text(afterText))
            : schema.nodes.paragraph.create();

          if (isTaskItem) {
            // Task list: taskList > taskItem(checked) > paragraph
            const taskItem = schema.nodes.taskItem.create(
              { checked: taskChecked },
              itemContent,
            );
            const list = schema.nodes.taskList.create(null, taskItem);

            const tr = newState.tr;
            tr.replaceWith(hardBreakPos, $from.end(), list);

            // Structure: [taskList](1) + [taskItem](1) + [paragraph](1) + textContent
            const cursorPos =
              hardBreakPos + 3 + (afterText ? afterText.length : 0);
            tr.setSelection(TextSelection.create(tr.doc, cursorPos));
            tr.setMeta('listAfterHardBreak', true);

            return tr;
          }

          // Regular list: bulletList/orderedList > listItem > paragraph
          const listType = bulletMatch ? 'bulletList' : 'orderedList';
          const listAttrs = orderedMatch
            ? { start: parseInt(orderedMatch[1], 10) }
            : {};
          const listItem = schema.nodes.listItem.create(null, itemContent);
          const list = schema.nodes[listType].create(listAttrs, listItem);

          // Delete from hardBreak to end of paragraph, replace with list structure
          const tr = newState.tr;
          tr.replaceWith(hardBreakPos, $from.end(), list);

          // Set cursor inside the list item's paragraph
          // List structure: [listType](1) + [listItem](1) + [paragraph](1) + textContent
          // Content inside paragraph starts at hardBreakPos + 3
          const cursorPos =
            hardBreakPos + 3 + (afterText ? afterText.length : 0);
          tr.setSelection(TextSelection.create(tr.doc, cursorPos));
          tr.setMeta('listAfterHardBreak', true);

          return tr;
        },
      }),
    ];
  },
});
