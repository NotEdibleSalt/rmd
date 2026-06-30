import { useEffect, useState, useRef, useCallback } from 'react';
import { useEditorStore, FileEntry, selectCurrentFile } from './store';
import { invoke } from '@tauri-apps/api/core';
import { open, confirm as dialogConfirm } from '@tauri-apps/plugin-dialog';

/* ─── Tree node model ─── */
interface DirNode {
  entry: FileEntry;
  children: DirNode[] | null; // null = not loaded yet
  expanded: boolean;
  loading: boolean;
}

/* ─── Context menu state ─── */
interface CtxMenu {
  x: number;
  y: number;
  entry: FileEntry;
}

async function readDir(path: string): Promise<FileEntry[]> {
  return invoke<FileEntry[]>('read_dir', { path });
}

function entriesToNodes(entries: FileEntry[]): DirNode[] {
  return entries.map(e => ({
    entry: e,
    children: e.is_dir ? null : [],
    expanded: false,
    loading: false,
  }));
}

/** Extract parent directory path or return empty if already root. */
function parentDir(path: string): string | null {
  const norm = path.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!norm || norm === '' || /^[a-zA-Z]:$/.test(norm)) return null; // drive root
  const idx = norm.lastIndexOf('/');
  if (idx <= 0) return null; // '/' or '/path' without parent
  // Handle Windows drive letters like C: -> keep C:/
  const parent = norm.substring(0, idx);
  if (/^[a-zA-Z]:$/.test(parent)) return parent + '/';
  return parent || null;
}

export function FileBrowser() {
  const currentFile = useEditorStore(selectCurrentFile);
  const {
    currentDir, setCurrentDir, openFile, deleteFile, renameFile,
    recentFiles, workspaceRoot, setWorkspaceRoot,
    setRecentFiles,
  } = useEditorStore();

  const [activeTab, setActiveTab] = useState<'files' | 'recent'>('files');
  const [tree, setTree] = useState<DirNode[]>([]);
  const [filterQuery, setFilterQuery] = useState('');
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const [navHistory, setNavHistory] = useState<string[]>([]);
  const [navIndex, setNavIndex] = useState(-1);
  const [editingPath, setEditingPath] = useState(false);
  const [pathInputValue, setPathInputValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const ctxMenuRef = useRef<HTMLDivElement>(null);
  const filterInputRef = useRef<HTMLInputElement>(null);
  const pathInputRef = useRef<HTMLInputElement>(null);

  // ─── Navigate to a directory ───

  const navigateTo = useCallback(async (dir: string) => {
    try {
      await readDir(dir); // validate it exists
      setCurrentDir(dir);
      setTree(entriesToNodes(await readDir(dir)));
      setNavHistory(prev => {
        const truncated = prev.slice(0, navIndex + 1);
        return [...truncated, dir];
      });
      setNavIndex(prev => prev + 1);
    } catch {
      console.error('Cannot navigate to:', dir);
    }
  }, [setCurrentDir, navIndex]);

  // ─── Initial load + sync currentDir ───

  useEffect(() => {
    if (!currentDir) return;
    readDir(currentDir).then(entries => {
      setTree(entriesToNodes(entries));
      // Seed history on first load
      setNavHistory(prev => {
        if (prev.length === 0) return [currentDir];
        if (prev[navIndex] !== currentDir) {
          const truncated = prev.slice(0, navIndex + 1);
          return [...truncated, currentDir];
        }
        return prev;
      });
      setNavIndex(prev => {
        if (prev < 0) return 0;
        return prev;
      });
    }).catch(console.error);
  }, [currentDir]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Auto-remove stale recent files ───

  useEffect(() => {
    if (activeTab !== 'recent' || recentFiles.length === 0) return;
    let cancelled = false;

    (async () => {
      // Group by parent directory to batch readDir calls
      const grouped: Record<string, string[]> = {};
      for (const path of recentFiles) {
        const dir = parentDir(path);
        if (!dir) continue;
        (grouped[dir] ??= []).push(path);
      }

      const missing: string[] = [];
      for (const [dir, files] of Object.entries(grouped)) {
        if (cancelled) return;
        try {
          const entries = await readDir(dir);
          const names = new Set(entries.map(e => e.name));
          const paths = new Set(entries.map(e => e.path));
          for (const f of files) {
            const name = f.replace(/\\/g, '/').split('/').pop() || '';
            if (!names.has(name) && !paths.has(f)) missing.push(f);
          }
        } catch {
          // Directory itself gone → remove all files under it
          missing.push(...files);
        }
      }

      if (!cancelled && missing.length > 0) {
        const updated = recentFiles.filter(p => !missing.includes(p));
        const state = useEditorStore.getState();
        const newConfig = { ...state.config, recent_files: updated };
        setRecentFiles(updated);
        invoke('set_config', { newConfig }).catch(() => {});
      }
    })();

    return () => { cancelled = true; };
  }, [activeTab, recentFiles]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Go up, back, forward ───

  const goUp = useCallback(() => {
    if (!currentDir) return;
    const parent = parentDir(currentDir);
    if (parent) navigateTo(parent);
  }, [currentDir, navigateTo]);

  const goBack = useCallback(() => {
    if (navIndex > 0) {
      const idx = navIndex - 1;
      const dir = navHistory[idx];
      if (dir) {
        setNavIndex(idx);
        setCurrentDir(dir);
        readDir(dir).then(entries => setTree(entriesToNodes(entries))).catch(console.error);
      }
    }
  }, [navIndex, navHistory, setCurrentDir]);

  const goForward = useCallback(() => {
    if (navIndex < navHistory.length - 1) {
      const idx = navIndex + 1;
      const dir = navHistory[idx];
      if (dir) {
        setNavIndex(idx);
        setCurrentDir(dir);
        readDir(dir).then(entries => setTree(entriesToNodes(entries))).catch(console.error);
      }
    }
  }, [navIndex, navHistory, setCurrentDir]);

  // ─── Path editing ───

  const startPathEdit = () => {
    setPathInputValue(currentDir || '');
    setEditingPath(true);
    setTimeout(() => pathInputRef.current?.focus(), 0);
  };

  const commitPathEdit = async () => {
    const val = pathInputValue.trim();
    setEditingPath(false);
    if (!val || val === currentDir) return;
    await navigateTo(val);
  };

  // ─── Expand / collapse directory node ───

  // ─── Expand / collapse directory node ───

  const toggleExpand = useCallback(async (node: DirNode) => {
    if (node.expanded) {
      // Collapse
      setTree(prev => toggleNodeInTree(prev, node.entry.path, { expanded: false }));
      return;
    }
    // Load children if not loaded
    if (node.children === null) {
      setTree(prev => toggleNodeInTree(prev, node.entry.path, { loading: true }));
      try {
        const entries = await readDir(node.entry.path);
        setTree(prev => toggleNodeInTree(prev, node.entry.path, {
          children: entriesToNodes(entries),
          expanded: true,
          loading: false,
        }));
      } catch {
        setTree(prev => toggleNodeInTree(prev, node.entry.path, { loading: false }));
      }
    } else {
      setTree(prev => toggleNodeInTree(prev, node.entry.path, { expanded: true }));
    }
  }, []);

  // ─── File operations ───

  const handleFileClick = useCallback(async (entry: FileEntry) => {
    if (entry.is_dir) return;
    await openFile(entry.path);
  }, [openFile]);

  const handleNewFile = async () => {
    try {
      const name = `新文档_${Date.now()}.md`;
      const rootDir = workspaceRoot || currentDir || '.';
      const path = `${rootDir}/${name}`;
      await invoke('create_file', { path });
      await openFile(path);
      // Refresh current node
      if (currentDir) {
        const entries = await readDir(currentDir);
        setTree(entriesToNodes(entries));
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleDelete = async (e: React.MouseEvent | undefined, entry: FileEntry) => {
    e?.stopPropagation();
    try {
      const title = '确认删除';
      const body = entry.is_dir
        ? `确定要删除目录「${entry.name}」及其所有内容？\n\n此操作不可撤销。删除后文件将无法恢复。`
        : `确定要删除文件「${entry.name}」？\n\n此操作不可撤销。删除后文件将无法恢复。`;
      const confirmed = await dialogConfirm(body, { title, kind: 'warning' });
      if (!confirmed) return;
    } catch {
      // Not in Tauri — fallback to browser confirm
      const msg = entry.is_dir
        ? `确定删除目录「${entry.name}」及其所有内容？\n此操作不可撤销。`
        : `确定删除「${entry.name}」？\n此操作不可撤销。`;
      if (!window.confirm(msg)) return;
    }
    try {
      await deleteFile(entry.path);
      // Refresh
      if (currentDir) {
        const entries = await readDir(currentDir);
        setTree(entriesToNodes(entries));
      }
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  const startRename = (entry: FileEntry) => {
    setRenamingPath(entry.path);
    setRenameValue(entry.name);
    setTimeout(() => renameInputRef.current?.focus(), 0);
  };

  const commitRename = useCallback(async () => {
    if (!renamingPath) return;
    const newName = renameValue.trim();
    if (!newName) { setRenamingPath(null); return; }
    const dir = renamingPath.substring(0, renamingPath.lastIndexOf('/'))
      || renamingPath.substring(0, renamingPath.lastIndexOf('\\'));
    const newPath = dir ? `${dir}/${newName}` : newName;
    if (newPath === renamingPath) { setRenamingPath(null); return; }
    try {
      await renameFile(renamingPath, newPath);
      if (currentDir) {
        const entries = await readDir(currentDir);
        setTree(entriesToNodes(entries));
      }
    } catch (err) {
      console.error('Rename failed:', err);
    }
    setRenamingPath(null);
  }, [renamingPath, renameValue, renameFile, currentDir]);

  // ─── Workspace ───

  const handleSetWorkspace = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: '设置工作区',
      });
      if (selected && typeof selected === 'string') {
        await setWorkspaceRoot(selected);
        setCurrentDir(selected);
      }
    } catch { /* not in tauri */ }
  };

  // ─── Context menu ───

  const handleContextMenu = useCallback((e: React.MouseEvent, entry: FileEntry) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, entry });
  }, []);

  const closeCtxMenu = useCallback(() => setCtxMenu(null), []);

  // Close context menu on outside click
  useEffect(() => {
    if (!ctxMenu) return;
    const handler = (e: MouseEvent) => {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as Node)) {
        closeCtxMenu();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [ctxMenu, closeCtxMenu]);

  const handleCtxRename = () => {
    if (!ctxMenu) return;
    startRename(ctxMenu.entry);
    closeCtxMenu();
  };

  const handleCtxDelete = () => {
    if (!ctxMenu) return;
    handleDelete(undefined, ctxMenu.entry);
    closeCtxMenu();
  };

  const handleCtxCopyPath = () => {
    if (!ctxMenu) return;
    navigator.clipboard.writeText(ctxMenu.entry.path).catch(console.error);
    closeCtxMenu();
  };

  // ─── Drag & Drop ───

  const handleDragStart = (e: React.DragEvent, path: string) => {
    e.dataTransfer.setData('text/plain', path);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, dirPath: string) => {
    if (!ctxMenu) e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverPath(dirPath);
  };

  const handleDragLeave = () => setDragOverPath(null);

  const handleDrop = async (e: React.DragEvent, targetDir: string) => {
    e.preventDefault();
    setDragOverPath(null);
    const sourcePath = e.dataTransfer.getData('text/plain');
    if (!sourcePath || sourcePath === targetDir) return;
    const fileName = sourcePath.replace(/\\/g, '/').split('/').pop();
    if (!fileName) return;
    const newPath = `${targetDir.replace(/\\/g, '/').replace(/\/+$/, '')}/${fileName}`;
    if (newPath === sourcePath.replace(/\\/g, '/')) return;
    try {
      await renameFile(sourcePath, newPath);
      // Refresh current view
      if (currentDir) {
        const entries = await readDir(currentDir);
        setTree(entriesToNodes(entries));
      }
    } catch (err) {
      console.error('Move failed:', err);
    }
  };

  // ─── Tree rendering ───

  const renderTreeNode = (node: DirNode, depth: number) => {
    const isActive = node.entry.path === currentFile;
    const isDir = node.entry.is_dir;
    const isDragOver = dragOverPath === node.entry.path;
    const isRenaming = renamingPath === node.entry.path;

    return (
      <div key={node.entry.path}>
        <div
          className={`file-item ${isActive ? 'active' : ''} ${isDir ? 'dir' : 'file'} ${isDragOver ? 'drag-over' : ''}`}
          style={{ paddingLeft: 12 + depth * 16 }}
          draggable={!isDir}
          onClick={() => isDir ? toggleExpand(node) : handleFileClick(node.entry)}
          onContextMenu={(e) => handleContextMenu(e, node.entry)}
          onDragStart={(e) => handleDragStart(e, node.entry.path)}
          onDragOver={(e) => isDir && handleDragOver(e, node.entry.path)}
          onDragLeave={isDir ? handleDragLeave : undefined}
          onDrop={(e) => isDir && handleDrop(e, node.entry.path)}
        >
          {/* Expand/collapse arrow for directories */}
          {isDir ? (
            <span className="file-arrow">{node.expanded ? '▼' : '▶'}</span>
          ) : (
            <span className="file-arrow-placeholder" />
          )}
          <span className="file-icon">{isDir ? '📁' : '📄'}</span>
          {isRenaming ? (
            <input
              ref={renameInputRef}
              className="file-rename-input"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                else if (e.key === 'Escape') setRenamingPath(null);
              }}
              onClick={(e) => e.stopPropagation()}
              spellCheck={false}
            />
          ) : (
            <span className="file-name">{node.entry.name}</span>
          )}
          {node.loading && <span className="file-loading" />}
        </div>
        {/* Render children if expanded */}
        {isDir && node.expanded && node.children && !filterQuery && (
          node.children.map(child => renderTreeNode(child, depth + 1))
        )}
      </div>
    );
  };

  const renderFilteredTree = (nodes: DirNode[]) => {
    const q = filterQuery.toLowerCase();
    if (!q) {
      return nodes.map(n => renderTreeNode(n, 0));
    }
    // Flatten all matching nodes regardless of depth
    const collect = (list: DirNode[], out: DirNode[]) => {
      for (const n of list) {
        if (n.entry.name.toLowerCase().includes(q)) {
          out.push(n);
        }
        if (n.children) collect(n.children, out);
      }
    };
    const flat: DirNode[] = [];
    collect(nodes, flat);
    if (flat.length === 0) {
      return <div className="file-browser-empty">无匹配文件</div>;
    }
    return flat.map(n => renderTreeNode(n, 0));
  };

  // ─── Render ───

  return (
    <div className="file-browser" onClick={closeCtxMenu}>
      {/* ── Header ── */}
      <div className="file-browser-header">
        <span>文件管理</span>
        <div className="file-browser-tabs">
          <button
            className={`toolbar-btn ${activeTab === 'files' ? 'active' : ''}`}
            onClick={() => setActiveTab('files')}
            title="文件浏览"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
          </button>
          <button
            className={`toolbar-btn ${activeTab === 'recent' ? 'active' : ''}`}
            onClick={() => setActiveTab('recent')}
            title="最近打开"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
          </button>
        </div>
      </div>

      {/* ── Recent tab ── */}
      {activeTab === 'recent' ? (
        <div className="file-browser-recent-list">
          {recentFiles.length === 0 ? (
            <div className="file-browser-empty">暂无最近文件</div>
          ) : (
            recentFiles.map((path, idx) => {
              const name = path.replace(/\\/g, '/').split('/').pop() || path;
              return (
                <div
                  key={idx}
                  className={`file-item recent ${path === currentFile ? 'active' : ''}`}
                  onClick={() => openFile(path)}
                  title={path}
                >
                  <span className="file-icon">📄</span>
                  <span className="file-name">{name}</span>
                  <button
                    className="file-delete-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      const updated = recentFiles.filter(p => p !== path);
                      if (updated.length === recentFiles.length) return;
                      setRecentFiles(updated);
                      const state = useEditorStore.getState();
                      const newConfig = { ...state.config, recent_files: updated };
                      import('@tauri-apps/api/core').then(({ invoke }) =>
                        invoke('set_config', { newConfig }).catch(() => {})
                      );
                    }}
                    title="移出最近打开"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                </div>
              );
            })
          )}
        </div>
      ) : (
        /* ── Files tab ── */
        <>
          {/* Toolbar: workspace + new file + filter */}
          <div className="file-browser-toolbar">
            <button className="toolbar-btn fb-workspace-btn" onClick={handleSetWorkspace} title={workspaceRoot || '设置工作区'}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2.5a1 1 0 0 1-.8-.4l-.9-1.2A1 1 0 0 0 15 3h-2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z"/>
                <path d="M20 21a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1h-2.9a1 1 0 0 1-.88-.55l-.42-.85a1 1 0 0 0-.92-.6H13a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z"/>
                <path d="M3 5a2 2 0 0 0 2 2h3"/>
                <path d="M3 3v13a2 2 0 0 0 2 2h3"/>
              </svg>
              {workspaceRoot && <span className="fb-workspace-label">工作区</span>}
            </button>
            <button className="toolbar-btn" onClick={handleNewFile} title="新建文件">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
            </button>
          </div>

          {/* Filter input */}
          <div className="file-browser-filter">
            <svg className="fb-filter-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              ref={filterInputRef}
              className="fb-filter-input"
              type="text"
              placeholder="过滤文件..."
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              spellCheck={false}
            />
            {filterQuery && (
              <button className="fb-filter-clear" onClick={() => { setFilterQuery(''); filterInputRef.current?.focus(); }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            )}
          </div>

          {/* Navigation path bar */}
          <div className="file-browser-navbar">
            <button className="navbar-btn" onClick={goBack} disabled={navIndex <= 0} title="后退">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
            </button>
            <button className="navbar-btn" onClick={goForward} disabled={navIndex >= navHistory.length - 1} title="前进">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </button>
            <button className="navbar-btn" onClick={goUp} disabled={!parentDir(currentDir || '')} title="上一级">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="19" x2="12" y2="5"/>
                <polyline points="5 12 12 5 19 12"/>
              </svg>
            </button>
            <div className="navbar-path" onClick={startPathEdit} title={currentDir || '未选择目录'}>
              {editingPath ? (
                <input
                  ref={pathInputRef}
                  className="navbar-path-input"
                  value={pathInputValue}
                  onChange={(e) => setPathInputValue(e.target.value)}
                  onBlur={commitPathEdit}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitPathEdit();
                    else if (e.key === 'Escape') setEditingPath(false);
                  }}
                  spellCheck={false}
                />
              ) : (
                <span className="navbar-path-text">{currentDir || '未选择目录'}</span>
              )}
            </div>
          </div>

          {/* File tree */}
          <div className="file-browser-list" ref={listRef}>
            {tree.length === 0 ? (
              <div className="file-browser-empty">暂无文件</div>
            ) : (
              renderFilteredTree(tree)
            )}
          </div>
        </>
      )}

      {/* ── Context menu ── */}
      {ctxMenu && (
        <div
          ref={ctxMenuRef}
          className="file-ctx-menu"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
        >
          <button className="file-ctx-item" onClick={handleCtxRename}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
            重命名
          </button>
          <button className="file-ctx-item" onClick={handleCtxDelete}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
            删除
          </button>
          <button className="file-ctx-item" onClick={handleCtxCopyPath}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
            复制路径
          </button>
        </div>
      )}
    </div>
  );
}

/* ─── Tree helper ─── */

function toggleNodeInTree(
  nodes: DirNode[],
  path: string,
  patch: Partial<DirNode>,
): DirNode[] {
  return nodes.map(n => {
    if (n.entry.path === path) {
      return { ...n, ...patch };
    }
    if (n.children) {
      return { ...n, children: toggleNodeInTree(n.children, path, patch) };
    }
    return n;
  });
}
