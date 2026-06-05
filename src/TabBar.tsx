import { useEditorStore } from './store';
import { useState } from 'react';

export function TabBar() {
  const tabs = useEditorStore((s) => s.tabs);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const switchTab = useEditorStore((s) => s.switchTab);
  const closeTab = useEditorStore((s) => s.closeTab);
  const theme = useEditorStore((s) => s.theme);
  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number; tabId: string;
  } | null>(null);

  const handleClose = (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation();
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) return;

    if (tab.isModified && tab.path) {
      // Auto-save then close
      const store = useEditorStore.getState();
      store.saveTab(tabId).then(() => closeTab(tabId));
      return;
    }

    if (tab.isModified && !tab.path) {
      const confirmed = window.confirm(`「${tab.name}」有未保存的更改，关闭将丢失所有内容。确定关闭？`);
      if (!confirmed) return;
    }

    closeTab(tabId);
  };

  const closeWithSave = (tabId: string) => {
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) return;
    if (tab.isModified && tab.path) {
      useEditorStore.getState().saveTab(tabId).then(() => closeTab(tabId));
    } else if (tab.isModified && !tab.path) {
      if (!window.confirm(`「${tab.name}」有未保存的更改，关闭将丢失所有内容。确定关闭？`)) return;
      closeTab(tabId);
    } else {
      closeTab(tabId);
    }
  };

  const closeOthers = async (tabId: string) => {
    const store = useEditorStore.getState();
    for (const t of tabs) {
      if (t.id === tabId) continue;
      if (t.isModified && t.path) {
        await store.saveTab(t.id);
        closeTab(t.id);
      } else if (t.isModified && !t.path) {
        // skip unsaved untitled — user would need to confirm individually
        continue;
      } else {
        closeTab(t.id);
      }
    }
  };

  const closeToRight = async (tabId: string) => {
    const store = useEditorStore.getState();
    const idx = tabs.findIndex(t => t.id === tabId);
    for (const t of tabs.slice(idx + 1)) {
      if (t.isModified && t.path) {
        await store.saveTab(t.id);
        closeTab(t.id);
      } else if (t.isModified && !t.path) {
        continue;
      } else {
        closeTab(t.id);
      }
    }
  };

  const closeAll = async () => {
    const store = useEditorStore.getState();
    for (const t of tabs) {
      if (t.isModified && t.path) {
        await store.saveTab(t.id);
        closeTab(t.id);
      } else if (!t.isModified) {
        closeTab(t.id);
      }
      // untitled modified tabs are skipped (require per-tab confirmation)
    }
  };

  const copyPath = (tabId: string) => {
    const tab = tabs.find(t => t.id === tabId);
    if (tab?.path) navigator.clipboard.writeText(tab.path);
  };

  return (
    <div className={`tab-bar tab-bar-${theme}`}>
       <div className="tab-list">
         {tabs.map((tab) => (
           <div
             key={tab.id}
             className={`tab ${tab.id === activeTabId ? 'active' : ''}`}
             onClick={() => switchTab(tab.id)}
             title={tab.path ?? tab.name}
             onContextMenu={(e) => {
               e.preventDefault();
               setContextMenu({ x: e.clientX, y: e.clientY, tabId: tab.id });
             }}
           >
             <span className="tab-name">
               {tab.name}
               {tab.isModified && <span className="tab-modified-dot"> ●</span>}
             </span>
             <button
               className="tab-close-btn"
               onClick={(e) => handleClose(e, tab.id)}
               title="关闭"
             >
               <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                 <line x1="6" y1="6" x2="18" y2="18"/>
                 <line x1="18" y1="6" x2="6" y2="18"/>
               </svg>
             </button>
           </div>
         ))}
       </div>
       {contextMenu && (
         <>
           <div className="context-menu-overlay" onClick={() => setContextMenu(null)} />
           <div
             className="context-menu"
             style={{ left: contextMenu.x, top: contextMenu.y }}
           >
             <button onClick={() => { closeWithSave(contextMenu.tabId); setContextMenu(null); }}>关闭</button>
             <button onClick={() => { closeOthers(contextMenu.tabId); setContextMenu(null); }}>关闭其他</button>
             <button onClick={() => { closeToRight(contextMenu.tabId); setContextMenu(null); }}>关闭右侧</button>
             <button onClick={() => { closeAll(); setContextMenu(null); }}>关闭全部</button>
             <div className="context-menu-separator" />
             <button onClick={() => { copyPath(contextMenu.tabId); setContextMenu(null); }}>复制文件路径</button>
           </div>
         </>
       )}
    </div>
  );
}
