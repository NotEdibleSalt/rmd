import { useEffect, useRef, useState } from 'react';
import { getEditorInstance } from '../editor-ref';
import {
  subscribe,
  getPending,
  hideAutocomplete,
  insertSelection,
  setPendingFocusIndex,
  type PendingAutocomplete,
} from './wikiLinkAutocompletePlugin';

export function WikiLinkAutocomplete() {
  const [pending, setPending] = useState<PendingAutocomplete | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Subscribe to show/hide state from the ProseMirror plugin
  useEffect(() => {
    return subscribe(() => {
      setPending(getPending());
    });
  }, []);

  // Reset focus when the query or suggestion set changes
  useEffect(() => {
    setFocusIndex(0);
  }, [pending?.query, pending?.suggestions]);

  // Sync focus index to the plugin so the capture-phase keydown handler
  // knows which file to insert when Enter is pressed.
  useEffect(() => {
    setPendingFocusIndex(focusIndex);
  }, [focusIndex]);

  // Keep the focused item scrolled into view
  useEffect(() => {
    if (!pending) return;
    const items = listRef.current?.querySelectorAll<HTMLButtonElement>(
      '.wiki-link-autocomplete-btn',
    );
    items?.[focusIndex]?.scrollIntoView({ block: 'nearest' });
  }, [focusIndex, pending]);

  // ─── Keyboard navigation ───
  // Attached to `document` (not the popup) so the editor keeps focus and the
  // user can keep typing characters to filter the query.

  useEffect(() => {
    if (!pending) return;

    const handler = (e: KeyboardEvent) => {
      const items = listRef.current?.querySelectorAll<HTMLButtonElement>(
        '.wiki-link-autocomplete-btn',
      );
      const count = items?.length ?? 0;

      switch (e.key) {
        case 'ArrowDown': {
          if (count === 0) return;
          e.preventDefault();
          setFocusIndex((i) => Math.min(i + 1, count - 1));
          break;
        }
        case 'ArrowUp': {
          if (count === 0) return;
          e.preventDefault();
          setFocusIndex((i) => Math.max(i - 1, 0));
          break;
        }
        case 'Enter': {
          if (count === 0) return;
          e.preventDefault();
          const file = pending.suggestions[focusIndex];
          if (file) insertSelection(file);
          break;
        }
        case 'Escape': {
          e.preventDefault();
          hideAutocomplete();
          getEditorInstance()?.view.focus();
          break;
        }
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [pending, focusIndex]);

  if (!pending) return null;

  const dismiss = () => {
    hideAutocomplete();
    getEditorInstance()?.view.focus();
  };

  return (
    <>
      <div className="wiki-link-overlay" onClick={dismiss} />
      <div
        className="wiki-link-autocomplete"
        ref={listRef}
        style={{ top: pending.top, left: pending.left }}
      >
        {pending.suggestions.length === 0 ? (
          <div className="wiki-link-empty">未找到匹配文件</div>
        ) : (
          pending.suggestions.map((file, idx) => (
            <button
              key={file.full_path}
              type="button"
              className={`wiki-link-autocomplete-btn${idx === focusIndex ? ' selected' : ''}`}
              onMouseEnter={() => setFocusIndex(idx)}
              onClick={(e) => {
                e.preventDefault();
                insertSelection(file);
              }}
            >
              <span className="wiki-link-name">{file.name}</span>
              <span className="wiki-link-path">{file.path}</span>
            </button>
          ))
        )}
      </div>
    </>
  );
}
