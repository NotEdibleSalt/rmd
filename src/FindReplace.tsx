import { useState, useRef, useEffect, useCallback } from 'react';
import { useEditorStore, selectSource } from './store';

export function FindReplace() {
  const source = useEditorStore(selectSource);
  const setSource = useEditorStore((s) => s.setSource);
  const findQuery = useEditorStore((s) => s.findQuery);
  const replaceQuery = useEditorStore((s) => s.replaceQuery);
  const setFindQuery = useEditorStore((s) => s.setFindQuery);
  const setReplaceQuery = useEditorStore((s) => s.setReplaceQuery);
  const setFindReplaceOpen = useEditorStore((s) => s.setFindReplaceOpen);
  const caseSensitive = useEditorStore((s) => s.findCaseSensitive);
  const setCaseSensitive = useEditorStore((s) => s.setFindCaseSensitive);

  const [matchIndex, setMatchIndex] = useState(0);
  const [matches, setMatches] = useState<{ index: number; length: number }[]>([]);
  const [showReplace, setShowReplace] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  // Compute matches whenever source or findQuery changes
  useEffect(() => {
    if (!findQuery.trim()) {
      setMatches([]);
      setMatchIndex(0);
      return;
    }
    const flags = caseSensitive ? 'g' : 'gi';
    // Escape regex special chars for literal search
    const escaped = findQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, flags);
    const found: { index: number; length: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = regex.exec(source)) !== null) {
      found.push({ index: m.index, length: m[0].length });
      if (!regex.global) break;
    }
    setMatches(found);
    setMatchIndex((prev) => Math.min(prev, Math.max(found.length - 1, 0)));
  }, [findQuery, source, caseSensitive]);

  // Focus input on open
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const goToMatch = useCallback((idx: number) => {
    if (matches.length === 0) return;
    const clamped = Math.max(0, Math.min(idx, matches.length - 1));
    setMatchIndex(clamped);
  }, [matches]);

  const replace = useCallback(() => {
    if (matches.length === 0 || matchIndex < 0 || matchIndex >= matches.length) return;
    const m = matches[matchIndex];
    const before = source.slice(0, m.index);
    const after = source.slice(m.index + m.length);
    const newSource = before + replaceQuery + after;
    setSource(newSource);
  }, [matches, matchIndex, source, replaceQuery, setSource]);

  const replaceAll = useCallback(() => {
    if (matches.length === 0) return;
    // Process from end to start to preserve indices
    let result = source;
    const escaped = findQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const flags = caseSensitive ? 'g' : 'gi';
    const regex = new RegExp(escaped, flags);
    result = result.replace(regex, replaceQuery);
    setSource(result);
  }, [matches, source, findQuery, replaceQuery, caseSensitive, setSource]);

  const close = () => {
    setFindReplaceOpen(false);
  };

  const currentText = matches.length > 0
    ? source.slice(matches[matchIndex].index, matches[matchIndex].index + matches[matchIndex].length)
    : '';

  return (
    <div className="find-replace-bar" onKeyDown={(e) => {
      if (e.key === 'Escape') { close(); e.stopPropagation(); }
    }}>
      <div className="find-replace-row">
        <svg className="find-replace-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input
          ref={inputRef}
          type="text"
          className="find-replace-input"
          placeholder="查找..."
          value={findQuery}
          onChange={(e) => setFindQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (e.shiftKey) goToMatch(matchIndex - 1);
              else goToMatch(matchIndex + 1);
            }
          }}
        />
        <span className="find-replace-count">
          {matches.length > 0 ? `${matchIndex + 1}/${matches.length}` : ''}
        </span>
        <button
          className={`find-replace-toggle ${caseSensitive ? 'active' : ''}`}
          onClick={() => { setCaseSensitive(!caseSensitive); setMatchIndex(0); }}
          title="区分大小写"
        >Aa</button>
        <button className="find-replace-btn" onClick={() => goToMatch(matchIndex - 1)} title="上一个 (Shift+Enter)" disabled={matches.length === 0}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <button className="find-replace-btn" onClick={() => goToMatch(matchIndex + 1)} title="下一个 (Enter)" disabled={matches.length === 0}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
        <button className="find-replace-toggle" onClick={() => setShowReplace(!showReplace)} title="替换">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 3h5v5M8 3H3v5"/><path d="M21 8l-5-5M3 8l5-5"/><path d="M21 21l-5-5M3 21l5-5"/><line x1="12" y1="3" x2="12" y2="21"/></svg>
        </button>
        <button className="find-replace-close" onClick={close} title="关闭 (Escape)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      {showReplace && (
        <div className="find-replace-row find-replace-row-replace">
          <svg className="find-replace-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 3h5v5M8 3H3v5"/><path d="M21 8l-5-5M3 8l5-5"/><line x1="12" y1="3" x2="12" y2="21"/></svg>
          <input
            type="text"
            className="find-replace-input"
            placeholder="替换为..."
            value={replaceQuery}
            onChange={(e) => setReplaceQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                replace();
              }
            }}
          />
          <button className="find-replace-btn" onClick={replace} disabled={matches.length === 0} title="替换当前">
            替换
          </button>
          <button className="find-replace-btn" onClick={replaceAll} disabled={matches.length === 0} title="替换全部">
            全部
          </button>
        </div>
      )}
      {matches.length > 0 && (
        <div className="find-replace-preview">
          <span className="find-replace-preview-text">
            ...{currentText.length > 40 ? currentText.slice(0, 40) + '…' : currentText}...
          </span>
        </div>
      )}
    </div>
  );
}
