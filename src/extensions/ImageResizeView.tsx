import { useCallback, useEffect, useRef, useState } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';

export function ImageResizeView({ node, updateAttributes, selected }: NodeViewProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const altInputRef = useRef<HTMLInputElement>(null);
  const [isResizing, setIsResizing] = useState(false);
  const [editingAlt, setEditingAlt] = useState(false);
  const [altDraft, setAltDraft] = useState('');

  const width = node.attrs.width as string | null;
  const altText = (node.attrs.alt as string) || '';

  // Auto-focus alt input when it appears
  useEffect(() => {
    if (editingAlt && altInputRef.current) {
      altInputRef.current.focus();
      altInputRef.current.select();
    }
  }, [editingAlt]);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startWidth = imgRef.current?.getBoundingClientRect().width || 0;

      setIsResizing(true);

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const dx = moveEvent.clientX - startX;
        const newWidth = Math.max(50, startWidth + dx);
        updateAttributes({ width: Math.round(newWidth) });
      };

      const handleMouseUp = () => {
        setIsResizing(false);
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [updateAttributes],
  );

  const handleAltStartEdit = useCallback(() => {
    setAltDraft(altText);
    setEditingAlt(true);
  }, [altText]);

  const handleAltSave = useCallback(() => {
    updateAttributes({ alt: altDraft });
    setEditingAlt(false);
  }, [altDraft, updateAttributes]);

  const handleAltCancel = useCallback(() => {
    setEditingAlt(false);
  }, []);

  const handleAltKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAltSave();
      } else if (e.key === 'Escape') {
        handleAltCancel();
      }
    },
    [handleAltSave, handleAltCancel],
  );

  return (
    <NodeViewWrapper
      className="image-resize-wrapper"
      style={{
        display: 'inline-block',
        position: 'relative',
        lineHeight: '0',
        verticalAlign: 'bottom',
      }}
      data-resizing={isResizing ? 'true' : undefined}
    >
      <img
        ref={imgRef}
        src={node.attrs.src as string}
        alt={altText}
        title={(node.attrs.title as string) || ''}
        style={{
          width: width ? `${width}px` : undefined,
          maxWidth: '100%',
          height: 'auto',
          borderRadius: '4px',
        }}
      />
      {selected && (
        <>
          <span
            className="image-resize-handle image-resize-handle-right"
            onMouseDown={handleResizeStart}
            contentEditable={false}
          />
          <span
            className="image-resize-handle image-resize-handle-corner"
            onMouseDown={handleResizeStart}
            contentEditable={false}
          />
          <span className="image-alt-bar" contentEditable={false}>
            {editingAlt ? (
              <input
                ref={altInputRef}
                className="image-alt-input"
                value={altDraft}
                onChange={(e) => setAltDraft(e.target.value)}
                onKeyDown={handleAltKeyDown}
                onBlur={handleAltSave}
                placeholder="输入图片替代文本…"
              />
            ) : (
              <button className="image-alt-btn" onClick={handleAltStartEdit} title="编辑替代文本">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" y1="16" x2="12" y2="12"/>
                  <line x1="12" y1="8" x2="12.01" y2="8"/>
                </svg>
                <span>{altText || '添加 alt 文本'}</span>
              </button>
            )}
          </span>
        </>
      )}
    </NodeViewWrapper>
  );
}
