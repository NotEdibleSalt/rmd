import { Extension } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import { createHardBreakPlugin } from './hardBreakPlugin';

export const HorizontalRuleAfterHardBreak = Extension.create({
  name: 'horizontalRuleAfterHardBreak',

  addProseMirrorPlugins() {
    return [
      createHardBreakPlugin({
        name: 'horizontalRuleAfterHardBreak',
        regex: /^(---|\*\*\*|___)$/,
        build: (schema) => {
          const hr = schema.nodes.horizontalRule.create();
          const newPara = schema.nodes.paragraph.create();
          return { content: Fragment.fromArray([hr, newPara]), cursorOffset: 2 };
        },
      }),
    ];
  },
});
