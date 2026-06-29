import { useCallback, useEffect, useRef, useState } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { getEditorInstance } from '../editor-ref';
import katex from 'katex';

function renderLatex(source: string): string | null {
  try {
    return katex.renderToString(source, { displayMode: true, throwOnError: false });
  } catch {
    return null;
  }
}

export function MathBlockNodeView({ node, updateAttributes, selected }: NodeViewProps) {
  const [editing, setEditing] = useState(false);
  const [code, setCode] = useState(node.attrs.content || '');
  const codeRef = useRef(code);
  codeRef.current = code;

  const html = renderLatex(code);

  const handleCodeChange = useCallback((value: string) => {
    setCode(value);
    updateAttributes({ content: value });
  }, [updateAttributes]);

  // Sync external changes when node gets selected
  useEffect(() => {
    if (selected && node.attrs.content !== code) {
      setCode(node.attrs.content);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  if (!editing) {
    return (
      <NodeViewWrapper
        className="math-block"
        data-selected={selected ? 'true' : undefined}
        onClick={() => setEditing(true)}
        onKeyDown={() => {}}
        role="button"
        tabIndex={0}
      >
        {html ? (
          <div className="math-block-render" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <div className="math-block-placeholder">加载 KaTeX 中...</div>
        )}
        <div className="math-block-edit-btn" title="编辑公式">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </div>
        {selected && (
          <div className="math-block-toolbar">
            <button
              className="math-toolbar-btn"
              title="复制 LaTeX"
              onClick={(e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(node.attrs.content || '');
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            </button>
            <button
              className="math-toolbar-btn"
              title="删除"
              onClick={(e) => {
                e.stopPropagation();
                const editor = getEditorInstance();
                if (editor) editor.chain().focus().deleteSelection().run();
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
            </button>
          </div>
        )}
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className="math-block" data-editing="true" data-selected={selected ? 'true' : undefined}>
      <textarea
        className="math-block-editor"
        value={code}
        onChange={(e) => handleCodeChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setEditing(false);
            e.currentTarget.blur();
          }
        }}
        onBlur={() => setEditing(false)}
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        placeholder="输入 LaTeX 公式..."
        rows={Math.max(2, code.split('\n').length)}
      />
      {html ? (
        <div className="math-block-render" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <div className="math-block-error">KaTeX 渲染错误</div>
      )}
    </NodeViewWrapper>
  );
}
