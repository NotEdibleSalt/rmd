import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useEditorStore, selectCurrentFile } from './store';
import { BacklinkEntry } from './lib/workspaceIndex';

interface GroupedBacklinks {
  filePath: string;
  fileName: string;
  entries: BacklinkEntry[];
  expanded: boolean;
}

const MAX_LINE_DISPLAY = 80;

function truncateLine(line: string, max: number): string {
  const trimmed = line.trim();
  return trimmed.length > max ? trimmed.slice(0, max) + '…' : trimmed;
}

export function BacklinksPanel() {
  const currentFile = useEditorStore(selectCurrentFile);
  const theme = useEditorStore((s) => s.theme);
  const findBacklinks = useEditorStore((s) => s.findBacklinks);
  const openFile = useEditorStore((s) => s.openFile);
  const workspaceRoot = useEditorStore((s) => s.workspaceRoot);
  const workspaceIndex = useEditorStore((s) => s.workspaceIndex);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groups, setGroups] = useState<GroupedBacklinks[]>([]);

  const targetName = useMemo(() => {
    if (!currentFile) return '';
    const fileName = currentFile.replace(/\\/g, '/').split('/').pop() || '';
    return fileName.replace(/\.[^.]+$/, '');
  }, [currentFile]);

  const root = workspaceRoot || workspaceIndex.root;

  // Refetch whenever the active file path changes.
  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      if (!targetName || !root) {
        if (!cancelled) {
          setGroups([]);
          setError(null);
        }
        return;
      }
      if (!cancelled) {
        setLoading(true);
        setError(null);
      }
      try {
        const entries = await invoke<BacklinkEntry[]>('find_backlinks', {
          workspaceRoot: root,
          targetName,
        });
        if (cancelled) return;
        const grouped = groupByFile(entries);
        setGroups(grouped);
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setGroups([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    refresh();
    return () => { cancelled = true; };
  }, [targetName, root]);

  // Also re-fetch when the store's saveStatus transitions to "saved" so the
  // list reflects the latest on-disk content without manual reload.
  const saveStatus = useEditorStore((s) => s.saveStatus);
  useEffect(() => {
    if (saveStatus === 'saved') {
      findBacklinks().catch(() => {});
    }
  }, [saveStatus, findBacklinks]);

  const toggleGroup = (filePath: string) => {
    setGroups(prev =>
      prev.map(g => (g.filePath === filePath ? { ...g, expanded: !g.expanded } : g))
    );
  };

  const handleOpenFile = (filePath: string) => {
    openFile(filePath).catch((e) => {
      console.error('Open backlink target failed:', e);
    });
  };

  const handleOpenLine = (filePath: string, lineNumber: number) => {
    openFile(filePath)
      .then(() => {
        // The Wysiwyg/Source editors don't expose a generic "scroll to line"
        // API yet, but we surface the line number so the user can find it
        // quickly. Future tasks can wire editor-level line jumping.
        console.log(`Backlink target opened at line ${lineNumber}: ${filePath}`);
      })
      .catch((e) => {
        console.error('Open backlink line failed:', e);
      });
  };

  const renderContent = () => {
    if (!currentFile) {
      return <div className="backlinks-empty">请先打开一个文档</div>;
    }
    if (!root) {
      return <div className="backlinks-empty">请先设置工作区根目录</div>;
    }
    if (loading) {
      return <div className="backlinks-loading">加载中…</div>;
    }
    if (error) {
      return <div className="backlinks-error">错误: {error}</div>;
    }
    if (groups.length === 0) {
      return <div className="backlinks-empty">暂无反向链接</div>;
    }
    return (
      <div className="backlinks-content">
        {groups.map((g) => (
          <div key={g.filePath} className="backlinks-group">
            <div
              className="backlinks-file"
              onClick={() => toggleGroup(g.filePath)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggleGroup(g.filePath);
                }
              }}
            >
              <span className={`backlinks-caret ${g.expanded ? 'expanded' : ''}`}>▸</span>
              <span
                className="backlinks-filename"
                title={g.filePath}
                onClick={(e) => {
                  e.stopPropagation();
                  handleOpenFile(g.filePath);
                }}
                role="link"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleOpenFile(g.filePath);
                  }
                }}
              >
                {g.fileName}
              </span>
              <span className="backlinks-count">{g.entries.length}</span>
            </div>
            {g.expanded && (
              <div className="backlinks-lines">
                {g.entries.map((entry, idx) => (
                  <div
                    key={`${entry.file_path}-${entry.line_number}-${idx}`}
                    className="backlinks-line"
                    onClick={() => handleOpenLine(entry.file_path, entry.line_number)}
                    role="button"
                    tabIndex={0}
                    title={`第 ${entry.line_number} 行`}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleOpenLine(entry.file_path, entry.line_number);
                      }
                    }}
                  >
                    <span className="backlinks-line-number">L{entry.line_number}</span>
                    <span className="backlinks-line-content">
                      {truncateLine(entry.line_content, MAX_LINE_DISPLAY)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className={`backlinks-panel backlinks-${theme}`}>
      <div className="backlinks-header">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
        <span>反向链接</span>
        {groups.length > 0 && <span className="backlinks-total">{groups.length}</span>}
      </div>
      {renderContent()}
    </div>
  );
}

function groupByFile(entries: BacklinkEntry[]): GroupedBacklinks[] {
  const map = new Map<string, GroupedBacklinks>();
  for (const e of entries) {
    const existing = map.get(e.file_path);
    if (existing) {
      existing.entries.push(e);
    } else {
      map.set(e.file_path, {
        filePath: e.file_path,
        fileName: e.file_name,
        entries: [e],
        expanded: true,
      });
    }
  }
  return Array.from(map.values()).sort((a, b) =>
    a.fileName.localeCompare(b.fileName)
  );
}
