import { useCallback, useEffect, useRef, useState } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import katex from 'katex';

function renderLatexInline(source: string): string | null {
  try {
    return katex.renderToString(source, { displayMode: false, throwOnError: false });
  } catch {
    return null;
  }
}

export function MathInlineNodeView({ node, updateAttributes, selected }: NodeViewProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(node.attrs.content || '');
  const inputRef = useRef<HTMLInputElement>(null);
  const html = renderLatexInline(node.attrs.content || '');

  // Focus input when entering edit mode
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  // Sync external changes
  useEffect(() => {
    if (!selected) return;
    if (node.attrs.content !== draft) {
      setDraft(node.attrs.content);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const commit = useCallback(() => {
    const content = draft.trim();
    if (content) {
      updateAttributes({ content });
    }
    setEditing(false);
  }, [draft, updateAttributes]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    }
    if (e.key === 'Escape') {
      setDraft(node.attrs.content || '');
      setEditing(false);
    }
  }, [commit, node.attrs.content]);

  if (editing) {
    return (
      <NodeViewWrapper as="span" className="math-inline math-inline-editing" data-selected={selected ? 'true' : undefined}>
        <span className="math-inline-prompt">$</span>
        <input
          ref={inputRef}
          className="math-inline-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          autoComplete="off"
        />
        <span className="math-inline-prompt">$</span>
        {draft && (
          <span
            className="math-inline-preview"
            dangerouslySetInnerHTML={{ __html: html || '' }}
          />
        )}
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper
      as="span"
      className="math-inline"
      data-selected={selected ? 'true' : undefined}
      onClick={() => setEditing(true)}
      title={node.attrs.content}
    >
      {html ? (
        <span className="math-inline-render" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <span className="math-inline-raw">${node.attrs.content || ''}$</span>
      )}
    </NodeViewWrapper>
  );
}
