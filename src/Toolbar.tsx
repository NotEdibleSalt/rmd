import { useState, useRef } from 'react';
import { useEditorStore, ViewMode, selectCurrentFile, selectIsModified, selectSource } from './store';
import { useMarkdownTheme } from './theme/MarkdownThemeProvider';
import { Grid3x3 } from 'lucide-react';
import { TableGridPicker } from './TableGridPicker';

const viewModes: { label: string; value: ViewMode; icon: string }[] = [
  { label: '编辑', value: 'wysiwyg', icon: '✏️' },
  { label: '源码', value: 'source', icon: '⌨️' },
  { label: '文档', value: 'doc', icon: '📄' },
];

const appThemes = [
  { id: 'light', icon: '☀️' },
  { id: 'dark', icon: '🌙' },
  { id: 'eye-care', icon: '🌿' },
  { id: 'minimal', icon: '◻' },
];

export function Toolbar() {
  const viewMode = useEditorStore((s) => s.viewMode);
  const setViewMode = useEditorStore((s) => s.setViewMode);
  const theme = useEditorStore((s) => s.theme);
  const setTheme = useEditorStore((s) => s.setTheme);
  const currentFile = useEditorStore(selectCurrentFile);
  const isModified = useEditorStore(selectIsModified);
  const fileBrowserOpen = useEditorStore((s) => s.fileBrowserOpen);
  const setFileBrowserOpen = useEditorStore((s) => s.setFileBrowserOpen);
  const outlineOpen = useEditorStore((s) => s.outlineOpen);
  const setOutlineOpen = useEditorStore((s) => s.setOutlineOpen);
  const setExportDialogOpen = useEditorStore((s) => s.setExportDialogOpen);
  const setSettingsOpen = useEditorStore((s) => s.setSettingsOpen);
  const openFile = useEditorStore((s) => s.openFile);
  const saveFile = useEditorStore((s) => s.saveFile);
  const source = useEditorStore(selectSource);

  const { themes: mdThemes, switchTheme, currentTheme } = useMarkdownTheme();
  const [showTablePicker, setShowTablePicker] = useState(false);
  const tableBtnRef = useRef<HTMLButtonElement>(null);

  const handleNewFile = () => {
    useEditorStore.getState().newTab();
  };

  const handleOpenFile = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
        multiple: false,
      });
      if (selected) {
        await openFile(selected);
      }
    } catch { /* not in tauri */ }
  };

  const handleSave = async () => {
    if (currentFile) {
      await saveFile();
    } else {
      try {
        const { save } = await import('@tauri-apps/plugin-dialog');
        const path = await save({
          filters: [{ name: 'Markdown', extensions: ['md'] }],
        });
        if (path) {
          const { invoke } = await import('@tauri-apps/api/core');
          await invoke('save_file', { path, content: source });
          const dir = path.replace(/\\/g, '/').replace(/\/[^/]+$/, '');
          const st = useEditorStore.getState();
          st.setCurrentFile(path);
          st.setCurrentDir(dir);
          st.setIsModified(false);
        }
      } catch { /* not in tauri */ }
    }
  };

  return (
    <div className={`toolbar toolbar-${theme}`}>
      <div className="toolbar-left">
        <span className="toolbar-brand">RMD</span>
        <div className="toolbar-divider" />
        <button className="toolbar-btn" onClick={handleNewFile} title="新建">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
        </button>
        <button className="toolbar-btn" onClick={handleOpenFile} title="打开">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        </button>
        <button className="toolbar-btn" onClick={handleSave} title="保存">
          {isModified && <span className="save-dot" />}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
        </button>
        <div className="toolbar-divider" />
        <button className={`toolbar-btn ${fileBrowserOpen ? 'active' : ''}`} onClick={() => setFileBrowserOpen(!fileBrowserOpen)} title="文件管理">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        </button>
        
      </div>

       <div className="toolbar-center">
         {viewModes.map((opt) => (
           <button
             key={opt.value}
             className={`toolbar-btn view-btn ${viewMode === opt.value ? 'active' : ''}`}
             onClick={() => setViewMode(opt.value)}
             title={opt.label}
           >
             <span>{opt.icon}</span>
           </button>
         ))}
         <div className="toolbar-divider" />
         <button className={`toolbar-btn ${outlineOpen ? 'active' : ''}`} onClick={() => setOutlineOpen(!outlineOpen)} title="大纲">
           <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
         </button>
         <button className={`toolbar-btn ${useEditorStore(s => s.searchOpen) ? 'active' : ''}`} onClick={() => useEditorStore.getState().setSearchOpen(!useEditorStore.getState().searchOpen)} title="搜索 (Ctrl+F)">
           <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
             <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
           </svg>
         </button>
       </div>

      {/* Insert section */}
      <div className="toolbar-divider" />
      <button
        ref={tableBtnRef}
        className={`toolbar-btn ${showTablePicker ? 'active' : ''}`}
        onClick={() => setShowTablePicker(!showTablePicker)}
        title="插入表格"
      >
        <Grid3x3 size={16} />
      </button>
      {showTablePicker && (
        <TableGridPicker
          onClose={() => setShowTablePicker(false)}
          buttonEl={tableBtnRef.current}
        />
      )}

      <div className="toolbar-right">
        <div className="toolbar-divider" />
        {appThemes.map((t) => (
          <button
            key={t.id}
            className={`toolbar-btn theme-btn ${theme === t.id ? 'active' : ''}`}
            onClick={() => setTheme(t.id)}
            title={t.id === 'eye-care' ? '护眼' : t.id === 'minimal' ? '简约' : t.id === 'dark' ? '暗黑' : '亮色'}
            style={{ width: 28, height: 28, fontSize: 13 }}
          >
            {t.icon}
          </button>
        ))}
        <div className="toolbar-divider" />
        <div className="md-theme-selector">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 4, verticalAlign: 'middle' }}>
            <circle cx="12" cy="12" r="5"/>
            <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
          </svg>
          <select
            className="md-theme-select"
            value={currentTheme || mdThemes[0]?.id}
            onChange={(e) => switchTheme(e.target.value)}
            title="Markdown 主题"
          >
            {mdThemes.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
        <button className="toolbar-btn" onClick={() => setExportDialogOpen(true)} title="导出">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </button>
        <button className="toolbar-btn" onClick={() => setSettingsOpen(true)} title="设置">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        </button>
      </div>
    </div>
  );
}
