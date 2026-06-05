import { useEditorStore, selectOutput } from './store';

export function OutlineView() {
  const output = useEditorStore(selectOutput);
  const toc = output?.toc || [];
  const theme = useEditorStore((s) => s.theme);

  const handleClick = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el.classList.add('heading-highlight');
      setTimeout(() => el.classList.remove('heading-highlight'), 2000);
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
              onClick={() => handleClick(item.id)}
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
