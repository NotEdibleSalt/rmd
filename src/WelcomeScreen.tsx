import { useEditorStore } from './store';
import { open } from '@tauri-apps/plugin-dialog';

export function WelcomeScreen() {
  const { recentFiles, openFile, newTab } = useEditorStore();

  return (
    <div className="welcome-screen">
      <div className="welcome-content">
        <div className="welcome-logo">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
            <polyline points="10 9 9 9 8 9"/>
          </svg>
        </div>
        <h1 className="welcome-title">rmd</h1>
        <p className="welcome-subtitle">Rich Markdown Editor</p>

        <div className="welcome-actions">
          <button className="welcome-btn welcome-btn-primary" onClick={() => newTab()}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            新建文档
          </button>
          <button className="welcome-btn" onClick={async () => {
            try {
              const selected = await open({ filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }], multiple: false });
              if (selected) {
                await openFile(selected as string);
              }
            } catch {
              newTab();
            }
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
            打开文件
          </button>
        </div>

        {recentFiles.length > 0 && (
          <div className="welcome-recent">
            <h3 className="welcome-section-title">最近打开</h3>
            <div className="welcome-recent-list">
              {recentFiles.map((path, idx) => {
                const name = path.replace(/\\/g, '/').split('/').pop() || path;
                return (
                  <button key={idx} className="welcome-recent-item" onClick={() => openFile(path)} title={path}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                    </svg>
                    <span>{name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="welcome-shortcuts">
          <h3 className="welcome-section-title">快捷键</h3>
          <div className="welcome-shortcuts-grid">
            <span className="shortcut-key"><kbd>Ctrl</kbd>+<kbd>N</kbd></span>
            <span className="shortcut-desc">新建文档</span>
            <span className="shortcut-key"><kbd>Ctrl</kbd>+<kbd>O</kbd></span>
            <span className="shortcut-desc">打开文件</span>
            <span className="shortcut-key"><kbd>Ctrl</kbd>+<kbd>S</kbd></span>
            <span className="shortcut-desc">保存文件</span>
            <span className="shortcut-key"><kbd>Ctrl</kbd>+<kbd>P</kbd></span>
            <span className="shortcut-desc">设置</span>
            <span className="shortcut-key"><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd></span>
            <span className="shortcut-desc">导出</span>
            <span className="shortcut-key"><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd></span>
            <span className="shortcut-desc">文件浏览器</span>
            <span className="shortcut-key"><kbd>Ctrl</kbd>+<kbd>F</kbd></span>
            <span className="shortcut-desc">搜索</span>
          </div>
        </div>
      </div>
    </div>
  );
}
