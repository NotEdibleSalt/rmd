import { useState, useEffect, useRef } from 'react';
import { useEditorStore } from './store';
import { invoke } from '@tauri-apps/api/core';

export function SearchPanel() {
  const { searchQuery, setSearchQuery, setSearchOpen, currentDir } = useEditorStore();
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const performSearch = async (query: string) => {
    if (!query.trim()) {
      setResults([]);
      setHasSearched(false);
      return;
    }
    setSearching(true);
    setHasSearched(true);
    try {
      const dir = currentDir || '.';
      const res = await invoke('search_files', { query, dir });
      setResults(res as any[]);
    } catch (e) {
      console.error(e);
    } finally {
      setSearching(false);
    }
  };

  // Incremental search: debounce input changes
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      performSearch(searchQuery);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery]);

  const handleOpenResult = async (filePath: string) => {
    const { openFile } = useEditorStore.getState();
    await openFile(filePath);
    setSearchOpen(false);
  };

  return (
    <div className="dialog-overlay" onClick={() => setSearchOpen(false)}>
      <div className="dialog search-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h2>搜索</h2>
          <button className="dialog-close" onClick={() => setSearchOpen(false)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="dialog-body">
          <div className="search-input-row">
            <input
              type="text"
              className="search-input"
              placeholder="搜索文件内容..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
            {searching && <span className="search-spinner" />}
          </div>
          <div className="search-results">
            {searching && <div className="search-status">搜索中...</div>}
            {!searching && hasSearched && results.length === 0 && (
              <div className="search-empty">未找到匹配内容</div>
            )}
            {!searching && hasSearched && results.length > 0 && (
              <div className="search-count">找到 {results.length} 个结果</div>
            )}
            {results.map((r, idx) => (
              <div key={idx} className="search-result-item" onClick={() => handleOpenResult(r.file_path)}>
                <div className="search-result-file">{r.file_name}</div>
                <div className="search-result-line">
                  <span className="search-result-lineno">第 {r.line} 行:</span>
                  <span className="search-result-content">{r.content}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
