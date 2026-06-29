import { useEditorStore, selectOutput } from './store';
import { getEditorInstance } from './editor-ref';

export function OutlineView() {
  const output = useEditorStore(selectOutput);
  const toc = output?.toc || [];
  const theme = useEditorStore((s) => s.theme);
  const viewMode = useEditorStore((s) => s.viewMode);

  const handleClick = (text: string) => {
    // WYSIWYG mode: find heading in ProseMirror doc via editor instance
    if (viewMode === 'wysiwyg') {
      const editor = getEditorInstance();
      if (editor) {
        let found = false;
        editor.state.doc.descendants((node, pos) => {
          if (found) return false;
          if (node.type.name === 'heading' && node.textContent === text) {
            editor.chain().focus().setTextSelection(pos + 1).scrollIntoView().run();
            found = true;
            return false;
          }
        });
        return;
      }
    }

    // Source mode: search source for heading line and scroll
    const source = useEditorStore.getState().tabs
      .find(t => t.id === useEditorStore.getState().activeTabId)?.source ?? '';
    const lines = source.split('\n');
    const lineIdx = lines.findIndex(l => {
      const trimmed = l.trimStart();
      // Match markdown heading syntax: # text, ## text, etc.
      return /^#{1,6}\s/.test(trimmed) && trimmed.replace(/^#+\s*/, '') === text;
    });
    if (lineIdx >= 0) {
      const { setScrollToLine } = useEditorStore.getState();
      setScrollToLine(lineIdx + 1);
    }
  };

  return (
    <div className={`outline-view outline-${theme}`}>
      <div className="outline-header">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
        <span>大纲视图</span>
      </div>
      <div className="outline-content">
        {toc.length === 0 ? (
          <div className="outline-empty">暂无标题，请在文档中添加标题</div>
        ) : (
          toc.map((item, idx) => (
            <div
              key={idx}
              className="outline-item"
              style={{ paddingLeft: `${(item.level - 1) * 20 + 12}px` }}
              onClick={() => handleClick(item.text)}
              title={item.text}
            >
              <span className={`outline-level outline-level-${item.level}`}>H{item.level}</span>
              <span className="outline-text">{item.text}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
