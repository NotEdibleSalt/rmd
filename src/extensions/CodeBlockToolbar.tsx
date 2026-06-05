import { useState, useRef, useEffect } from 'react';
import type { Editor } from '@tiptap/react';
import { CODE_LANGUAGES } from './BacktickSelector';

interface Props {
  editor: Editor;
  language: string;
  pos: { from: number; to: number };
  coords: { left: number; top: number };
  onClose: () => void;
}

const COPY_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

export function CodeBlockToolbar({ editor, language, pos, coords, onClose }: Props) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [focusIndex, setFocusIndex] = useState(0);
  const gridRef = useRef<HTMLDivElement>(null);

  const filteredLangs = filter
    ? CODE_LANGUAGES.filter(l => l.toLowerCase().includes(filter.toLowerCase()))
    : CODE_LANGUAGES;

  // Reset focus index when filtered list changes
  useEffect(() => {
    setFocusIndex(0);
  }, [filter]);

  const setLanguage = (lang: string) => {
    editor.chain().focus().setTextSelection(pos).updateAttributes('codeBlock', { language: lang }).run();
    onClose();
  };

  const copyContent = () => {
    const text = editor.state.doc.textBetween(pos.from, pos.to);
    navigator.clipboard.writeText(text).catch(console.error);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.stopPropagation();
      if (filteredLangs.length > 0) {
        setLanguage(filteredLangs[0]);
      }
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      setFocusIndex(0);
      requestAnimationFrame(() => gridRef.current?.querySelector<HTMLButtonElement>('.bt-lang-btn')?.focus());
    }
  };

  const handleGridKeyDown = (e: React.KeyboardEvent) => {
    const buttons = gridRef.current?.querySelectorAll<HTMLButtonElement>('.bt-lang-btn');
    if (!buttons || buttons.length === 0) return;

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        const next = Math.min(focusIndex + 1, buttons.length - 1);
        setFocusIndex(next);
        buttons[next]?.focus();
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        const prev = Math.max(focusIndex - 1, 0);
        setFocusIndex(prev);
        buttons[prev]?.focus();
        break;
      }
      case 'Enter': {
        e.preventDefault();
        if (focusIndex >= 0 && focusIndex < filteredLangs.length) {
          setLanguage(filteredLangs[focusIndex]);
        }
        break;
      }
      case 'Escape': {
        e.preventDefault();
        setOpen(false);
        break;
      }
    }
  };

  return (
    <div className="code-block-toolbar" style={{ left: coords.left, top: coords.top }}>
      <div className="cbt-row">
        <button className="cbt-lang-btn" onClick={() => setOpen(!open)}>
          {language || 'plaintext'} ▼
        </button>
        <button className="cbt-copy-btn" onClick={copyContent} title="复制代码">
          {COPY_ICON}
        </button>
      </div>
      {open && (
        <div className="cbt-lang-dropdown" onKeyDown={handleGridKeyDown}>
          <input
            className="bt-lang-input"
            placeholder="过滤语言..."
            autoFocus
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={handleInputKeyDown}
          />
          <div className="bt-lang-grid" ref={gridRef}>
            {filteredLangs.map((lang, i) => (
              <button
                key={lang}
                className="bt-lang-btn"
                onClick={() => setLanguage(lang)}
                onFocus={() => setFocusIndex(i)}
                tabIndex={-1}
              >
                {lang}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
