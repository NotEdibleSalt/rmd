import { Mark, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { useEditorStore } from '../store';

export interface WikiLinkAttrs {
  target: string;
  missing: boolean;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    wikiLink: {
      insertWikiLink: (target: string) => ReturnType;
    };
  }
}

// Matches [[target]] or [[target|display]].  The negative lookahead
// (?!\[) rejects bracket chains like [[[Page]] — those are almost
// always a sign of prior malformed insertion, and interpreting the
// inner [ as part of the target would silently hide the mistake.
export const WIKI_LINK_REGEX = /\[\[(?!\[)([^\]|]+)(?:\|([^\]]*))?\]\]/g;

/// Normalize a wikilink target by stripping ./ prefix and .md/.markdown extension.
/// This allows [[./bb.md]] to resolve to the same workspace file as [[bb]].
export function normalizeTarget(raw: string): string {
  return raw
    .replace(/^[.\/\\]+/, '')       // strip leading ./ or .\
    .replace(/\.(md|markdown)$/i, ''); // strip markdown extension
}

export const WikiLinkMark = Mark.create({
  name: 'wikiLink',
  inclusive: false,
  spanning: true,

  addAttributes() {
    return {
      target: {
        default: null,
        parseHTML: (el) => {
          const href = el.getAttribute('href');
          if (href && href !== '#') {
            try {
              return decodeURIComponent(href);
            } catch {
              return href;
            }
          }
          const dataAttr = el.getAttribute('data-wikilink');
          if (dataAttr && dataAttr !== 'true') return dataAttr;
          return null;
        },
        renderHTML: (attrs) => {
          if (!attrs.target) return {};
          return {
            'data-wikilink': attrs.target,
            href: attrs.target,
          };
        },
      },
      missing: {
        default: false,
        parseHTML: (el) => el.classList.contains('wikilink-missing'),
        renderHTML: (attrs) => {
          return attrs.missing ? { class: 'wikilink-missing' } : {};
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'a[data-wikilink]' }];
  },

  // Markdown serialization: emit `[[target|display]]`.
  // The @tiptap/markdown manager calls renderMarkdown with a synthetic node
  // whose `content` is a placeholder string. We split the output at the
  // placeholder: everything before = opening, everything after = closing,
  // with the actual display text rendered between them.
  // We always include the pipe (even when display === target would prefer
  // `[[target]]`) because we can't see the real display text here — the
  // output `[[Page|Page]]` is semantically valid and the appendTransaction
  // plugin normalizes it on the next edit.
  renderMarkdown: (node, helpers) => {
    const target = (node.attrs?.target ?? '').toString();
    const display = helpers.renderChildren(node);
    return `[[${target}|${display}]]`;
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'a',
      mergeAttributes(HTMLAttributes, {
        class: 'wikilink',
        href: '#',
      }),
      0,
    ];
  },

  addCommands() {
    return {
      insertWikiLink:
        (target: string) =>
        ({ chain }) => {
          const normalized = normalizeTarget(target);
          const missing = !useEditorStore.getState().workspaceIndex.resolve(normalized);
          return chain()
            .insertContent({
              type: 'text',
              text: normalized,
              marks: [{ type: this.name, attrs: { target: normalized, missing } }],
            })
            .run();
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('wikiLinkTransform'),
        appendTransaction: (_transactions, _oldState, newState) => {
          const tr = newState.tr;
          let changed = false;
          const markType = newState.schema.marks.wikiLink;
          if (!markType) return null;
          newState.doc.descendants((node, pos) => {
            if (!node.isText) return;
            if (node.marks.some((m) => m.type === markType)) return;
            const text = node.text ?? '';
            if (!text.includes('[[')) return;
            const replacements: Array<{ from: number; to: number; target: string; display: string }> = [];
            const re = new RegExp(WIKI_LINK_REGEX.source, 'g');
            let m: RegExpExecArray | null;
            while ((m = re.exec(text)) !== null) {
              let target = m[1].trim();
              // Normalize: strip ./ prefix and .md/.markdown extension
              const normalized = normalizeTarget(target);
              // Reject if the result is empty or still contains path separators
              if (!normalized || /[/\\]/.test(normalized)) continue;
              replacements.push({
                from: pos + m.index,
                to: pos + m.index + m[0].length,
                target: normalized,
                display: (m[2] ?? target).trim(),
              });
            }
            for (let i = replacements.length - 1; i >= 0; i--) {
              const r = replacements[i];
              const missing = !useEditorStore.getState().workspaceIndex.resolve(r.target);
              tr.replaceWith(
                r.from,
                r.to,
                newState.schema.text(r.display, [markType.create({ target: r.target, missing })])
              );
              changed = true;
            }
          });
          return changed ? tr : null;
        },
      }),
    ];
  },
});
