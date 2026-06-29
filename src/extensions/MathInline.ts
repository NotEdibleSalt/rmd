import { Node, InputRule } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { MathInlineNodeView } from './MathInlineNodeView';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mathInline: {
      insertMathInline: (content?: string) => ReturnType;
    };
  }
}

export const MathInline = Node.create({
  name: 'mathInline',

  priority: 120,

  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      content: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-math') || '',
        renderHTML: (attrs) => ({ 'data-math': attrs.content }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-math]' }];
  },

  renderHTML({ node }) {
    return ['span', { 'data-math': node.attrs.content }, node.attrs.content];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathInlineNodeView);
  },

  // ─── Markdown roundtrip ───

  markdownTokenName: 'math_inline',

  markdownTokenizer: {
    name: 'math_inline',
    level: 'inline',
    start: '$',
    tokenize(src: string) {
      // Don't match $$ (block math inside inline — should not happen, but safe)
      if (!src.startsWith('$') || src.startsWith('$$')) return undefined;
      // Match $...$ — non-greedy, content may not contain newlines
      const match = src.match(/^\$(.+?)\$(?!\$)/);
      if (!match) return undefined;
      return { type: 'math_inline', raw: match[0], text: match[1] };
    },
  },

  parseMarkdown: (token) => {
    if (token.type !== 'math_inline') return [];
    return [{ type: 'mathInline', attrs: { content: token.text || '' } }];
  },

  renderMarkdown: (node) => {
    return `$${node.attrs?.content || ''}$`;
  },

  addInputRules() {
    return [
      new InputRule({
        // Match $content$ — negative lookahead avoids matching $$ (block math)
        find: /\$(?!\$)(.+?)\$$/,
        handler: ({ state, range, match }) => {
          const content = match[1];
          if (!content) return;
          const node = state.schema.nodes.mathInline?.create({ content });
          if (!node) return;
          state.tr.replaceRangeWith(range.from, range.to, node);
        },
      }),
    ];
  },

  addCommands() {
    return {
      insertMathInline:
        (content?: string) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { content: content || '\\sum_{i=1}^n i' },
          }),
    };
  },
});
