import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { getEditorInstance } from './editor-ref';

const MAX_ROWS = 10;
const MAX_COLS = 10;

interface TableGridPickerProps {
  onClose: () => void;
  buttonEl: HTMLElement | null;
}

export function TableGridPicker({ onClose, buttonEl }: TableGridPickerProps) {
  const [hoverPos, setHoverPos] = useState<{ rows: number; cols: number } | null>(null);
  const [keyboardPos, setKeyboardPos] = useState<{ rows: number; cols: number }>({ rows: 3, cols: 3 });
  const [isKeyboardNav, setIsKeyboardNav] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Positioning: fixed below button, flip if no space
  const [positionStyle, setPositionStyle] = useState<React.CSSProperties>({});
  useEffect(() => {
    if (!buttonEl) return;
    const rect = buttonEl.getBoundingClientRect();
    const pickerHeight = 280;
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow >= pickerHeight ? rect.bottom + 4 : rect.top - pickerHeight - 4;
    setPositionStyle({
      position: 'fixed',
      top: `${top}px`,
      left: `${Math.max(rect.left, 8)}px`,
      zIndex: 1000,
    });
  }, [buttonEl]);

  // Insert table
  const insertTable = useCallback((rows: number, cols: number) => {
    const editor = getEditorInstance();
    if (!editor) return;
    editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
    onClose();
  }, [onClose]);

  // Keyboard navigation
  useEffect(() => {
    if (!buttonEl) return;
    const handler = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          setKeyboardPos(prev => ({ ...prev, rows: Math.max(prev.rows - 1, 1) }));
          setIsKeyboardNav(true);
          break;
        case 'ArrowDown':
          e.preventDefault();
          setKeyboardPos(prev => ({ ...prev, rows: Math.min(prev.rows + 1, MAX_ROWS) }));
          setIsKeyboardNav(true);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          setKeyboardPos(prev => ({ ...prev, cols: Math.max(prev.cols - 1, 1) }));
          setIsKeyboardNav(true);
          break;
        case 'ArrowRight':
          e.preventDefault();
          setKeyboardPos(prev => ({ ...prev, cols: Math.min(prev.cols + 1, MAX_COLS) }));
          setIsKeyboardNav(true);
          break;
        case 'Enter':
          e.preventDefault();
          insertTable(keyboardPos.rows, keyboardPos.cols);
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [buttonEl, keyboardPos, insertTable, onClose]);

  // Determine current highlight
  const displayPos = isKeyboardNav ? keyboardPos : hoverPos;
  const labelRows = displayPos?.rows ?? 0;
  const labelCols = displayPos?.cols ?? 0;

  return createPortal(
    <>
      <div className="table-grid-overlay" onClick={onClose} />
      <div
        className="table-grid-picker"
        ref={pickerRef}
        style={positionStyle}
        onMouseEnter={() => setIsKeyboardNav(false)}
      >
        <div className="table-grid-label">插入表格</div>
        <div className="table-grid">
          {Array.from({ length: MAX_ROWS }, (_, ri) => (
            <div className="table-grid-row" key={ri}>
              {Array.from({ length: MAX_COLS }, (_, ci) => {
                const selected = displayPos && ri < displayPos.rows && ci < displayPos.cols;
                return (
                  <div
                    key={ci}
                    className={`table-grid-cell ${selected ? 'selected' : ''}`}
                    onMouseEnter={() => {
                      setIsKeyboardNav(false);
                      setHoverPos({ rows: ri + 1, cols: ci + 1 });
                    }}
                    onClick={() => {
                      const rows = ri + 1;
                      const cols = ci + 1;
                      insertTable(rows, cols);
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>
        {displayPos && (
          <div className="table-grid-size">{labelRows} × {labelCols}</div>
        )}
      </div>
    </>,
    document.body
  );
}
