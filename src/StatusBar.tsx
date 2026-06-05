import { useEditorStore, selectCurrentFile, selectIsModified, selectOutput } from './store';

export function StatusBar() {
  const output = useEditorStore(selectOutput);
  const currentFile = useEditorStore(selectCurrentFile);
  const isModified = useEditorStore(selectIsModified);
  const theme = useEditorStore((s) => s.theme);
  const viewMode = useEditorStore((s) => s.viewMode);
  const saveStatus = useEditorStore((s) => s.saveStatus);
  const stats = output?.stats;

  return (
    <div className={`statusbar statusbar-${theme}`}>
      <div className="statusbar-left">
        {currentFile ? (
          <span className="statusbar-item">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            {currentFile.split(/[\\/]/).pop()}
            {isModified && ' ●'}
          </span>
        ) : (
          <span className="statusbar-item">未保存</span>
        )}
        <span className={`statusbar-save-status statusbar-save-${saveStatus}`}>
          {saveStatus === 'saving' && (
            <><span className="statusbar-spinner" /> 保存中...</>
          )}
          {saveStatus === 'saved' && (
            <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg> 已保存</>
          )}
        </span>
      </div>
      <div className="statusbar-right">
        {stats && (
          <>
            <span className="statusbar-item">字数: {stats.char_count}</span>
            <span className="statusbar-item">词数: {stats.word_count}</span>
            <span className="statusbar-item">行数: {stats.line_count}</span>
            <span className="statusbar-item">标题: {stats.heading_count}</span>
          </>
        )}
        <span className="statusbar-item">{viewMode === 'wysiwyg' ? '编辑模式' : viewMode === 'source' ? '源码模式' : viewMode === 'doc' ? '文档排版' : '发布预览'}</span>
        <span className="statusbar-item">{theme === 'light' ? '亮色' : theme === 'dark' ? '暗黑' : theme === 'eye-care' ? '护眼' : '简约'}</span>
      </div>
    </div>
  );
}
