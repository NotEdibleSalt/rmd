import { useEffect, useCallback, useState, useRef } from 'react';
import { useEditorStore } from './store';
import { Toolbar } from './Toolbar';
import { TabBar } from './TabBar';
import { StatusBar } from './StatusBar';
import { WysiwygEditor } from './WysiwygEditor';
import { SourceEditor } from './SourceEditor';
import { DocPreview } from './DocPreview';
import { OutlineView } from './OutlineView';
import { ExportDialog } from './ExportDialog';
import { SettingsPanel } from './SettingsPanel';
import { FileBrowser } from './FileBrowser';
import { SearchPanel } from './SearchPanel';
import { FindReplace } from './FindReplace';
import { ShortcutsPanel } from './ShortcutsPanel';
import { MarkdownThemeProvider } from './theme/MarkdownThemeProvider';
import { SavePromptModal } from './SavePromptModal';
import { WelcomeScreen } from './WelcomeScreen';
import { BacklinksPanel } from './BacklinksPanel';
import { GraphView } from './GraphView';
import './App.css';
import './code-highlight.css';

function renderMainView(viewMode: string) {
  switch (viewMode) {
    case 'wysiwyg': return <WysiwygEditor key="wysiwyg" />;
    case 'source': return <SourceEditor key="source" />;
    case 'doc': return <DocPreview key="doc" />;
    default: return <WysiwygEditor key="wysiwyg" />;
  }
}

function App() {
  const { theme, parseMarkdown, setConfig, setTheme } = useEditorStore();
  const [closeModalState, setCloseModalState] = useState<{
    message: string;
    resolve: (action: 'save' | 'discard' | 'cancel') => void;
  } | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const cfg = await invoke('get_config');
        if (cfg) {
          setConfig(cfg as any);
          setTheme((cfg as any).theme || 'light');
          // Auto-open last file
          const lastFile = (cfg as any).last_file;
          if (lastFile) {
            const { openFile, setRecentFiles } = useEditorStore.getState();
            setRecentFiles((cfg as any).recent_files || []);
            await openFile(lastFile);
          }
        }
      } catch {
        // Not in Tauri or config missing
      }
    }
    load();
  }, []);

  useEffect(() => { parseMarkdown(); }, []);
  useEffect(() => { document.documentElement.setAttribute('data-theme', theme); }, [theme]);

   const handleKeyDown = useCallback((e: KeyboardEvent) => {
     const s = useEditorStore.getState();
     if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); s.saveFile(); }
     if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'e') { e.preventDefault(); s.setExportDialogOpen(true); }
     if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'f') { e.preventDefault(); s.setFileBrowserOpen(!s.fileBrowserOpen); }
     if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'o') { e.preventDefault(); s.setOutlineOpen(!s.outlineOpen); }
     if ((e.ctrlKey || e.metaKey) && e.key === 'p') { e.preventDefault(); s.setSettingsOpen(true); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        s.setSearchOpen(!s.searchOpen);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'h') {
        e.preventDefault();
        s.setFindReplaceOpen(!s.findReplaceOpen);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault();
        s.setShortcutsOpen(!s.shortcutsOpen);
      }
      if (e.key === 'Escape') {
        if (s.shortcutsOpen) s.setShortcutsOpen(false);
        if (s.findReplaceOpen) s.setFindReplaceOpen(false);
        if (s.settingsOpen) s.setSettingsOpen(false);
        if (s.exportDialogOpen) s.setExportDialogOpen(false);
        if (s.searchOpen) s.setSearchOpen(false);
      }
   }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Window close guard: Rust intercepts CloseRequested, emits "app://close-requested"
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const { invoke } = await import('@tauri-apps/api/core');

        unlisten = await getCurrentWindow().listen<undefined>('app://close-requested', async () => {
          const s = useEditorStore.getState();

          const anyModified = s.tabs.some(t => t.isModified);
          const titledModified = s.tabs.filter(t => t.isModified && t.path);
          const untitledModified = s.tabs.filter(t => t.isModified && !t.path);

          if (!anyModified) {
            invoke('app_allow_close');
            return;
          }

          // Auto-save all titled modified tabs
          for (const tab of titledModified) {
            try {
              await invoke('save_file', { path: tab.path, content: tab.source });
              await new Promise(r => setTimeout(r, 0));
            } catch (e) {
              console.error('Auto-save on close failed:', e);
            }
          }

          // If only titled tabs were modified (all now saved), close silently
          if (untitledModified.length === 0) {
            // Mark all as not modified
            useEditorStore.setState(s0 => ({
              tabs: s0.tabs.map(t => ({ ...t, isModified: false })),
            }));
            invoke('app_allow_close');
            return;
          }

          // Prompt for untitled modified tabs
          const msg = untitledModified.length === 1
            ? `有 1 个无标题文档未保存，关闭将丢失所有更改。`
            : `有 ${untitledModified.length} 个无标题文档未保存，关闭将丢失所有更改。`;

          const action = await new Promise<'save' | 'discard' | 'cancel'>((resolve) => {
            setCloseModalState({ message: msg, resolve });
          });

          setCloseModalState(null);

          if (action === 'cancel') return;

          // save or discard — either way, mark all as not modified and close
          useEditorStore.setState(s0 => ({
            tabs: s0.tabs.map(t => ({ ...t, isModified: false })),
          }));
          invoke('app_allow_close');
        });
      } catch {
        // Not in Tauri — use beforeunload as fallback
      }
    })();
    return () => { unlisten?.(); };
  }, []);

  // Web fallback (non-Tauri): native beforeunload prompt
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      const s = useEditorStore.getState();
      if (s.tabs.some(t => t.isModified)) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  // External file drag-and-drop via Tauri
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
        unlisten = await getCurrentWebviewWindow().onDragDropEvent((event) => {
          if (event.payload.type === 'drop') {
            const paths = event.payload.paths as string[];
            const mdFiles: string[] = [];
            const imageFiles: string[] = [];
            for (const p of paths) {
              const lower = p.toLowerCase();
              if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
                mdFiles.push(p);
              } else if (lower.match(/\.(png|jpg|jpeg|gif|svg|webp|bmp)$/)) {
                imageFiles.push(p);
              }
            }
            const s = useEditorStore.getState();
            // Open first .md file
            if (mdFiles.length > 0) {
              s.openFile(mdFiles[0]);
            }
            // Insert dragged images via copy-to-media logic
            for (const imgPath of imageFiles) {
              handleWindowDroppedImage(imgPath, s);
            }
          }
        });
      } catch {
        // Not in Tauri
      }
    })();
    return () => { unlisten?.(); };
  }, []);

  const fileBrowserOpen = useEditorStore((s) => s.fileBrowserOpen);
  const outlineOpen = useEditorStore((s) => s.outlineOpen);
  const activeRightTab = useEditorStore((s) => s.activeRightTab);
  const setActiveRightTab = useEditorStore((s) => s.setActiveRightTab);
  const graphViewOpen = useEditorStore((s) => s.graphViewOpen);
  const openGraphView = useEditorStore((s) => s.openGraphView);
  const exportDialogOpen = useEditorStore((s) => s.exportDialogOpen);
  const settingsOpen = useEditorStore((s) => s.settingsOpen);
  const shortcutsOpen = useEditorStore((s) => s.shortcutsOpen);
  const searchOpen = useEditorStore((s) => s.searchOpen);
  const findReplaceOpen = useEditorStore((s) => s.findReplaceOpen);
  const viewMode = useEditorStore((s) => s.viewMode);
  const tabs = useEditorStore((s) => s.tabs);
  const hasNoTabs = tabs.length === 0;
  const sidebarLeftWidth = useEditorStore((s) => s.sidebarLeftWidth);
  const sidebarRightWidth = useEditorStore((s) => s.sidebarRightWidth);
  const setSidebarLeftWidth = useEditorStore((s) => s.setSidebarLeftWidth);
  const setSidebarRightWidth = useEditorStore((s) => s.setSidebarRightWidth);

  // ─── Resize drag state ───
  const dragging = useRef<'left' | 'right' | null>(null);
  const startX = useRef(0);
  const startW = useRef(0);

  const onResizeStart = useCallback((side: 'left' | 'right') => (e: React.PointerEvent) => {
    dragging.current = side;
    startX.current = e.clientX;
    startW.current = side === 'left' ? sidebarLeftWidth : sidebarRightWidth;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [sidebarLeftWidth, sidebarRightWidth]);

  const onResizeMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    const delta = e.clientX - startX.current;
    const newW = Math.max(160, Math.min(800, startW.current + (dragging.current === 'left' ? delta : -delta)));
    if (dragging.current === 'left') setSidebarLeftWidth(newW);
    else setSidebarRightWidth(newW);
  }, [setSidebarLeftWidth, setSidebarRightWidth]);

  const onResizeEnd = useCallback(() => {
    dragging.current = null;
  }, []);

  return (
    <MarkdownThemeProvider>
    <div className="app-container">
      <Toolbar />
      <TabBar />
      <div className="app-body" onPointerMove={onResizeMove} onPointerUp={onResizeEnd} onPointerCancel={onResizeEnd}>
        {fileBrowserOpen && (
          <>
            <div className="sidebar sidebar-left" style={{ width: sidebarLeftWidth }}>
              <FileBrowser />
            </div>
            <div className="resize-handle resize-handle-right" onPointerDown={onResizeStart('left')} />
          </>
        )}
        <div className="main-content" key={viewMode}>
          {hasNoTabs ? <WelcomeScreen /> : (
            <>
              {findReplaceOpen && <FindReplace />}
              {renderMainView(viewMode)}
            </>
          )}
        </div>
        {outlineOpen && (
          <>
            <div className="resize-handle resize-handle-left" onPointerDown={onResizeStart('right')} />
            <div className="sidebar sidebar-right" style={{ width: sidebarRightWidth }}>
              <div className="right-sidebar-tabs" role="tablist">
                <button
                  className={`right-sidebar-tab ${activeRightTab === 'outline' ? 'active' : ''}`}
                  onClick={() => setActiveRightTab('outline')}
                  role="tab"
                  type="button"
                  title="大纲"
                >
                  大纲
                </button>
                <button
                  className={`right-sidebar-tab ${activeRightTab === 'backlinks' ? 'active' : ''}`}
                  onClick={() => setActiveRightTab('backlinks')}
                  role="tab"
                  type="button"
                  title="反向链接"
                >
                  反向链接
                </button>
                <button
                  className="right-sidebar-tab right-sidebar-graph-btn"
                  onClick={() => openGraphView()}
                  title="图谱"
                  type="button"
                  aria-label="打开链接图谱"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="6" cy="6" r="3" />
                    <circle cx="18" cy="6" r="3" />
                    <circle cx="12" cy="18" r="3" />
                    <line x1="8.5" y1="7.5" x2="11" y2="15.5" />
                    <line x1="15.5" y1="7.5" x2="13" y2="15.5" />
                    <line x1="9" y1="6" x2="15" y2="6" />
                  </svg>
                  图谱
                </button>
              </div>
              {activeRightTab === 'outline' ? <OutlineView /> : <BacklinksPanel />}
            </div>
          </>
        )}
      </div>
      <StatusBar />
      {exportDialogOpen && <ExportDialog />}
      {settingsOpen && <SettingsPanel />}
      {searchOpen && <SearchPanel />}
      {shortcutsOpen && <ShortcutsPanel />}
      {graphViewOpen && <GraphView />}
      {closeModalState && (
        <SavePromptModal
          message={closeModalState.message}
          onSave={() => closeModalState.resolve('save')}
          onDiscard={() => closeModalState.resolve('discard')}
          onCancel={() => closeModalState.resolve('cancel')}
        />
      )}
    </div>
    </MarkdownThemeProvider>
  );
}

/**
 * Handle an image file dropped anywhere on the window (via Tauri onDragDropEvent).
 * Copies the image to the media/ folder and inserts into the editor.
 */
async function handleWindowDroppedImage(imgPath: string, store: ReturnType<typeof useEditorStore.getState>) {
  const { ensureImageSaveDir } = await import('./store');

  // 首次弹出目录选择，后续自动复用
  const saveDir = await ensureImageSaveDir();
  if (!saveDir) return;

  // 自动重命名并复制到保存目录
  const origName = imgPath.replace(/\\/g, '/').split('/').pop() || 'image.png';
  const filename = `${Date.now()}-${origName}`;
  const destPath = `${saveDir}/${filename}`;

  try {
    const { copyFile, mkdir } = await import('@tauri-apps/plugin-fs');
    await mkdir(saveDir, { recursive: true }).catch(() => {});
    await copyFile(imgPath, destPath);
    await store.insertImageFromPath(destPath);
  } catch (e) {
    console.error('Failed to copy dropped image to media dir, falling back to Rust read+save:', e);
    // Fallback: read + write via Rust IPC (uses std::fs, bypasses fs plugin scope)
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const b64 = await invoke<string>('read_image_base64', { path: imgPath });
      const savedPath = await invoke<string>('save_image', {
        base64Data: b64,
        saveDir,
        filename,
      });
      await store.insertImageFromPath(savedPath);
    } catch (e2) {
      console.error('Failed to process dropped image (both copy and Rust fallback):', e2);
    }
  }
}

export default App;
