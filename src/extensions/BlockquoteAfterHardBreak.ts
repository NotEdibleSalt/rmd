import { Extension } from '@tiptap/core';
import { createHardBreakPlugin } from './hardBreakPlugin';

export const BlockquoteAfterHardBreak = Extension.create({
  name: 'blockquoteAfterHardBreak',

  addProseMirrorPlugins() {
    return [
      createHardBreakPlugin({
        name: 'blockquoteAfterHardBreak',
        regex: /^\s*>\s(.*)$/,
        build: (schema, match) => {
          const afterText = match[1];
          const paraContent = afterText
            ? schema.nodes.paragraph.create(null, schema.text(afterText))
            : schema.nodes.paragraph.create();
          const blockquote = schema.nodes.blockquote.create(null, paraContent);
          const cursorOffset = 2 + (afterText ? afterText.length : 0);
          return { content: blockquote, cursorOffset };
        },
      }),
    ];
  },
});
