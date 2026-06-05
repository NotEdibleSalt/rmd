import { Extension, InputRule } from '@tiptap/core';

/**
 * Auto-converts markdown link syntax `[text](url)` typed in the WYSIWYG editor
 * into a clickable link mark as soon as the closing `)` is entered.
 */
export const MarkdownLinkInputRule = Extension.create({
  name: 'markdownLinkInputRule',

  addInputRules() {
    return [
      new InputRule({
        find: /\[([^\]]+)\]\(([^)]*)\)$/,
        handler: ({ state, range, match }) => {
          const [, text, url] = match;
          if (!url) return;
          const linkType = state.schema.marks.link;
          const linkMark = linkType?.create({ href: url });
          if (!linkMark) return;
          state.tr
            .delete(range.from, range.to)
            .insert(range.from, state.schema.text(text, [linkMark]))
            .removeStoredMark(linkType);
        },
      }),
    ];
  },
});
