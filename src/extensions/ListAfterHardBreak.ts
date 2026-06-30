import { Extension } from '@tiptap/core';
import { createHardBreakPlugin } from './hardBreakPlugin';

export const ListAfterHardBreak = Extension.create({
  name: 'listAfterHardBreak',

  addProseMirrorPlugins() {
    return [
      createHardBreakPlugin({
        name: 'listAfterHardBreak',
        regex: /^(?:([-+*])\s(.*)|(\d+)\.\s(.*))$/,
        build: (schema, match) => {
          const [, bulletMarker, bulletText, orderedNum, orderedText] = match;
          const isBullet = bulletMarker !== undefined;
          const rawAfterMarker = isBullet ? bulletText : orderedText;

          // Check for task list pattern: "- [ ] task" or "- [x] completed"
          let isTask = false;
          let taskChecked = false;
          let afterText = rawAfterMarker;

          if (isBullet) {
            const taskMatch = rawAfterMarker.match(/^\[([ x])\]\s(.*)$/);
            if (taskMatch) {
              isTask = true;
              taskChecked = taskMatch[1] === 'x';
              afterText = taskMatch[2];
            }
          }

          const itemContent = afterText
            ? schema.nodes.paragraph.create(null, schema.text(afterText))
            : schema.nodes.paragraph.create();
          const cursorOffset = 3 + (afterText ? afterText.length : 0);

          if (isTask) {
            const taskItem = schema.nodes.taskItem.create(
              { checked: taskChecked },
              itemContent,
            );
            const list = schema.nodes.taskList.create(null, taskItem);
            return { content: list, cursorOffset };
          }

          const listType = isBullet ? 'bulletList' : 'orderedList';
          const listAttrs = orderedNum ? { start: parseInt(orderedNum, 10) } : {};
          const listItem = schema.nodes.listItem.create(null, itemContent);
          const list = schema.nodes[listType].create(listAttrs, listItem);
          return { content: list, cursorOffset };
        },
      }),
    ];
  },
});
