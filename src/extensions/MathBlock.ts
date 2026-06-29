import { Node, textblockTypeInputRule } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { MathBlockNodeView } from './MathBlockNodeView';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mathBlock: {
      insertMathBlock: (content?: string) => ReturnType;
    };
  }
}

export const MathBlock = Node.create({
  name: 'mathBlock',

  priority: 120,

  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      content: {
        default: '',
        parseHTML: (el) => el.textContent?.trim() || '',
        renderHTML: (attrs) => ({ content: attrs.content }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-math-block]' }];
  },

  renderHTML({ node }) {
    return ['div', { 'data-math-block': '' }, node.attrs.content];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathBlockNodeView);
  },

  // ─── Markdown roundtrip ───

  markdownTokenName: 'math_block',

  markdownTokenizer: {
    name: 'math_block',
    level: 'block',
    start: '$$',
    tokenize(src: string) {
      if (!src.startsWith('$$')) return undefined;
      const match = src.match(/^\$\$\n?([\s\S]*?)\n?\$\$/);
      if (!match) return undefined;
      return { type: 'math_block', raw: match[0], text: match[1].trim() };
    },
  },

  parseMarkdown: (token) => {
    if (token.type !== 'math_block') return [];
    return [{ type: 'mathBlock', attrs: { content: token.text || '' } }];
  },

  renderMarkdown: (node) => {
    const content = node.attrs?.content || '';
    return `$$\n${content}\n$$`;
  },

  addInputRules() {
    return [
      textblockTypeInputRule({
        // Match $$...$$ at the start of a paragraph
        find: /^\$\$(.+?)\$\$$/,
        type: this.type,
        getAttributes: (match) => ({ content: match[1]?.trim() || '' }),
      }),
    ];
  },

  addCommands() {
    return {
      insertMathBlock:
        (content?: string) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { content: content || 'E = mc^2' },
          }),
    };
  },
});
