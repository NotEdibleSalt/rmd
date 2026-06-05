import { Node } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { MermaidNodeView } from './MermaidNodeView';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mermaid: {
      insertMermaid: (content?: string) => ReturnType;
    };
  }
}

export const MermaidNode = Node.create({
  name: 'mermaid',

  // Higher priority than CodeBlock (default 100) so parseMarkdown for code tokens
  // runs first and can intercept ```mermaid before the code block handler.
  priority: 150,

  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      content: {
        default: '',
        parseHTML: (el) => {
          return el.textContent?.trim() || '';
        },
        renderHTML: (attrs) => {
          return { content: attrs.content };
        },
      },
    };
  },

  parseHTML() {
    return [
      { tag: 'pre code.language-mermaid', priority: 100 },
      { tag: 'pre[data-language="mermaid"]', priority: 100 },
    ];
  },

  renderHTML({ node }) {
    return [
      'pre',
      { 'data-language': 'mermaid' },
      ['code', { class: 'language-mermaid' }, node.attrs.content],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MermaidNodeView);
  },

  // ─── Markdown roundtrip (via @tiptap/markdown MarkdownManager) ───

  markdownTokenName: 'code',

  parseMarkdown: (token, helpers) => {
    // Only intercept fenced code blocks with language "mermaid"
    if (token.lang !== 'mermaid') return [];

    return helpers.createNode(
      'mermaid',
      { content: token.text || '' },
    );
  },

  renderMarkdown: (node) => {
    const content = node.attrs?.content || '';
    return `\`\`\`mermaid\n${content}\n\`\`\``;
  },

  addCommands() {
    return {
      insertMermaid:
        (content?: string) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: {
              content: content || 'graph TD\n    A[Start] --> B[End]',
            },
          });
        },
    };
  },
});
