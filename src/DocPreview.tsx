import { useMemo } from 'react';
import { useEditorStore, selectSource } from './store';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkWikiLink from 'remark-wiki-link';
import rehypeRaw from 'rehype-raw';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import { MarkdownImg } from './utils/image';

const components = { img: MarkdownImg };

export function DocPreview() {
  const source = useEditorStore(selectSource);
  const config = useEditorStore((s) => s.config);
  const theme = useEditorStore((s) => s.theme);
  // Subscribe to workspaceIndex so the wiki-link plugin re-evaluates
  // "exists vs missing" styling when the workspace is rebuilt.
  const workspaceIndex = useEditorStore((s) => s.workspaceIndex);

  const wikiLinkPlugins = useMemo(() => {
    // remark-wiki-link v2 types its options as `{}`; we use a narrow `as any`
    // cast here only to satisfy TS for the plugin config shape. Documented
    // per project AGENTS.md.
    const permalinks = Array.from(workspaceIndex.nameToPath.values());
    return [
      [remarkWikiLink, {
        aliasDivider: '|',
        wikiLinkClassName: 'wikilink',
        newClassName: 'wikilink-missing',
        permalinks,
        pageResolver: (name: string) => [name],
        hrefTemplate: (slug: string) => `#${slug}`,
      } as any],
    ] as any;
  }, [workspaceIndex]);

  return (
    <div className={`markdown-preview preview-${theme}`}>
      <div className="preview-toolbar">
        <span className="preview-label">文档排版预览</span>
      </div>
      <div className="preview-content doc-layout">
        <div className="doc-page" style={{ fontSize: `${config.preview_font_size}px`, lineHeight: config.line_height }}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath, ...wikiLinkPlugins]}
            rehypePlugins={[rehypeRaw, rehypeKatex, rehypeHighlight]}
            components={components}
          >
            {source}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
