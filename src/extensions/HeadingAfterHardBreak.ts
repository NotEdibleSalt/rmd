import { Extension } from '@tiptap/core';
import { createHardBreakPlugin } from './hardBreakPlugin';

export const HeadingAfterHardBreak = Extension.create({
  name: 'headingAfterHardBreak',

  addProseMirrorPlugins() {
    return [
      createHardBreakPlugin({
        name: 'headingAfterHardBreak',
        regex: /^(#{1,6})\s(.*)$/,
        build: (schema, match) => {
          const level = match[1].length;
          const afterText = match[2];
          const content = afterText
            ? schema.nodes.heading.create({ level }, schema.text(afterText))
            : schema.nodes.heading.create({ level });
          const cursorOffset = 1 + (afterText ? afterText.length : 0);
          return { content, cursorOffset };
        },
      }),
    ];
  },
});
