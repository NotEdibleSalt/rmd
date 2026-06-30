import { useState, useEffect, useCallback } from 'react';
import { useEditorStore, AppConfig } from './store';
import { useMarkdownTheme } from './theme/MarkdownThemeProvider';
import { open } from '@tauri-apps/plugin-dialog';

export function SettingsPanel() {
  const { config, setConfig, setSettingsOpen, externalThemePath } = useEditorStore();
  const {
    switchTheme, themes, currentTheme,
    configureThemeStorageDir, uploadExternalThemeZip,
    getExternalThemeList, deleteExternalTheme,
    externalThemeDir, refreshExternal,
  } = useMarkdownTheme();

  const [externalThemes, setExternalThemes] = useState<{ path: string; name: string; dir_name: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const refreshExternalThemes = useCallback(async () => {
    const list = await getExternalThemeList();
    setExternalThemes(list);
  }, [getExternalThemeList]);

  // Load external theme list on mount
  useEffect(() => {
    refreshExternalThemes();
  }, [refreshExternalThemes]);

  const handleUploadZip = async () => {
    setUploading(true);
    try {
      const result = await uploadExternalThemeZip();
      if (result) {
        setExternalThemes(result);
        await refreshExternal();
      }
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (path: string) => {
    setDeleting(path);
    try {
      await deleteExternalTheme(path);
      await refreshExternalThemes();
      await refreshExternal();
    } finally {
      setDeleting(null);
    }
  };

  const update = (partial: Partial<AppConfig>) => {
    setConfig({ ...config, ...partial });
    if (partial.theme) {
      useEditorStore.getState().setTheme(partial.theme);
    }
  };

  return (
    <div className="dialog-overlay" onClick={() => setSettingsOpen(false)}>
      <div className="dialog settings-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h2>设置</h2>
          <button className="dialog-close" onClick={() => setSettingsOpen(false)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="dialog-body settings-body">
          <div className="settings-section">
            <h3>编辑设置</h3>
            <div className="setting-row">
              <label>编辑器字号</label>
              <input type="range" min="12" max="24" value={config.editor_font_size} onChange={(e) => update({ editor_font_size: parseInt(e.target.value) })} />
              <span className="setting-value">{config.editor_font_size}px</span>
            </div>
            <div className="setting-row">
              <label>等宽字体</label>
              <select value={config.font_family || 'system-ui'} onChange={(e) => update({ font_family: e.target.value })}>
                <option value="system-ui">系统默认</option>
                <option value="'JetBrains Mono', 'Fira Code', 'Consolas', monospace">JetBrains Mono</option>
                <option value="'Fira Code', 'Consolas', monospace">Fira Code</option>
                <option value="'Consolas', 'Monaco', monospace">Consolas</option>
                <option value="'Source Code Pro', monospace">Source Code Pro</option>
                <option value="'Cascadia Code', monospace">Cascadia Code</option>
              </select>
            </div>
            <div className="setting-row">
              <label>预览字号</label>
              <input type="range" min="12" max="24" value={config.preview_font_size} onChange={(e) => update({ preview_font_size: parseInt(e.target.value) })} />
              <span className="setting-value">{config.preview_font_size}px</span>
            </div>
            <div className="setting-row">
              <label>行高</label>
              <input type="range" min="1.2" max="2.5" step="0.1" value={config.line_height} onChange={(e) => update({ line_height: parseFloat(e.target.value) })} />
              <span className="setting-value">{config.line_height}</span>
            </div>
            <div className="setting-row">
              <label>自动保存</label>
              <input type="checkbox" checked={config.auto_save} onChange={(e) => update({ auto_save: e.target.checked })} />
            </div>
            <div className="setting-row">
              <label>显示行号</label>
              <input type="checkbox" checked={config.line_numbers} onChange={(e) => update({ line_numbers: e.target.checked })} />
            </div>
            <div className="setting-row">
              <label>自动换行</label>
              <input type="checkbox" checked={config.word_wrap} onChange={(e) => update({ word_wrap: e.target.checked })} />
            </div>
            <div className="setting-row">
              <label>语法提示</label>
              <input type="checkbox" checked={config.syntax_hint} onChange={(e) => update({ syntax_hint: e.target.checked })} />
            </div>
            <div className="setting-row">
              <label>拼写检查</label>
              <input type="checkbox" checked={config.spell_check} onChange={(e) => update({ spell_check: e.target.checked })} />
            </div>
            <div className="setting-row">
              <label>自动格式化</label>
              <input type="checkbox" checked={config.auto_format} onChange={(e) => update({ auto_format: e.target.checked })} />
            </div>
          </div>

          <div className="settings-section">
            <h3>默认设置</h3>
            <div className="setting-row">
              <label>默认视图</label>
              <select value={config.default_view} onChange={(e) => update({ default_view: e.target.value })}>
                <option value="rich">富文本预览</option>
                <option value="source">源码编辑</option>
                <option value="doc">文档排版</option>
              </select>
            </div>
            <div className="setting-row">
              <label>界面主题</label>
              <select value={config.theme} onChange={(e) => update({ theme: e.target.value })}>
                <option value="light">亮色</option>
                <option value="dark">暗黑</option>
                <option value="eye-care">护眼</option>
                <option value="minimal">简约</option>
              </select>
            </div>
            <div className="setting-row">
              <label>工作区根目录</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 1 }}>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                  {config.workspace_root || '(未设置)'}
                </span>
                <button
                  className="btn btn-secondary"
                  onClick={async () => {
                    try {
                      const selected = await open({
                        directory: true,
                        multiple: false,
                        title: '选择工作区根目录',
                      });
                      if (selected) {
                        update({ workspace_root: selected });
                        const { setWorkspaceRoot } = useEditorStore.getState();
                        await setWorkspaceRoot(selected);
                      }
                    } catch { /* not in tauri */ }
                  }}
                  style={{ flexShrink: 0 }}
                >
                  选择目录
                </button>
                {config.workspace_root && (
                  <button
                    className="btn btn-secondary"
                    onClick={() => update({ workspace_root: '' })}
                    style={{ flexShrink: 0 }}
                  >
                    清除
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="settings-section">
            <h3>图片设置</h3>
            <div className="setting-row">
              <label>图片保存目录</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 1 }}>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                  {config.image_save_dir || '(默认 - 文档同目录下的 media/)'}
                </span>
                <button
                  className="btn btn-secondary"
                  onClick={async () => {
                    try {
                      const selected = await open({
                        directory: true,
                        multiple: false,
                        title: '选择图片保存目录',
                      });
                      if (selected) {
                        update({ image_save_dir: selected });
                      }
                    } catch { /* not in tauri */ }
                  }}
                  style={{ flexShrink: 0 }}
                >
                  选择目录
                </button>
                {config.image_save_dir && (
                  <button
                    className="btn btn-secondary"
                    onClick={() => update({ image_save_dir: '' })}
                    style={{ flexShrink: 0 }}
                  >
                    重置
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="settings-section">
            <h3>Markdown 主题</h3>

            {/* Built-in theme selector */}
            <div className="setting-row">
              <label>内置主题</label>
              <select
                value={currentTheme || themes[0]?.id}
                onChange={(e) => switchTheme(e.target.value)}
              >
                {themes.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>

            {/* External theme storage dir */}
            <div className="setting-row">
              <label>主题存放目录</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 1 }}>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                  {externalThemeDir || '(未设置 - 默认位置)'}
                </span>
                <button className="btn btn-secondary" onClick={configureThemeStorageDir} style={{ flexShrink: 0 }}>
                  选择目录
                </button>
              </div>
            </div>

            {/* Upload zip */}
            <div className="setting-row">
              <label>导入 ZIP 主题</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 1 }}>
                <button className="btn btn-secondary" onClick={handleUploadZip} disabled={uploading} style={{ flexShrink: 0 }}>
                  选择 ZIP 文件
                </button>
                {uploading && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>解压中...</span>}
              </div>
            </div>

            {/* External themes list */}
            <div className="setting-row" style={{ flexDirection: 'column', alignItems: 'stretch', paddingTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <label style={{ minWidth: 'auto', fontSize: 13, fontWeight: 600 }}>已导入的主题</label>
                <button className="btn btn-secondary" onClick={refreshExternalThemes} style={{ padding: '4px 10px', fontSize: 12 }}>
                  刷新
                </button>
              </div>
              {externalThemes.length === 0 ? (
                <span style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 0' }}>
                  暂无导入的主题
                </span>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {externalThemes.map((t) => (
                    <div
                      key={t.path}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '6px 10px', borderRadius: 6,
                        background: 'var(--bg-secondary)',
                        border: t.path === externalThemePath ? '1px solid var(--accent)' : '1px solid transparent',
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, color: 'var(--text-muted)' }}>
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                      </svg>
                      <span style={{ flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{t.dir_name}</span>
                      <button
                        className="btn btn-secondary"
                        style={{ padding: '2px 8px', fontSize: 12, color: 'var(--danger)', flexShrink: 0 }}
                        onClick={() => handleDelete(t.path)}
                        disabled={deleting === t.path}
                      >
                        {deleting === t.path ? '...' : '删除'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Current external theme path */}
            {externalThemePath && (
              <div className="setting-row">
                <label>当前外部主题</label>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                  {externalThemePath}
                </span>
              </div>
            )}
          </div>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-primary" onClick={() => setSettingsOpen(false)}>关闭</button>
        </div>
      </div>
    </div>
  );
}
