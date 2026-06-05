import { useEditorStore } from './store';

interface ShortcutEntry {
  keys: string[];
  label: string;
}

interface ShortcutGroup {
  title: string;
  items: ShortcutEntry[];
}

const GROUPS: ShortcutGroup[] = [
  {
    title: '常用操作',
    items: [
      { keys: ['Ctrl', 'S'], label: '保存文件' },
      { keys: ['Ctrl', 'P'], label: '打开设置' },
      { keys: ['Ctrl', '/'], label: '快捷键帮助' },
      { keys: ['Esc'], label: '关闭当前面板' },
    ],
  },
  {
    title: '查找与替换',
    items: [
      { keys: ['Ctrl', 'F'], label: '在文件中查找' },
      { keys: ['Ctrl', 'H'], label: '查找并替换' },
      { keys: ['Enter'], label: '下一个匹配项（查找栏打开时）' },
      { keys: ['Shift', 'Enter'], label: '上一个匹配项（查找栏打开时）' },
    ],
  },
  {
    title: '视图',
    items: [
      { keys: ['Ctrl', 'Shift', 'E'], label: '导出对话框' },
      { keys: ['Ctrl', 'Shift', 'F'], label: '切换文件浏览器' },
      { keys: ['Ctrl', 'Shift', 'O'], label: '切换大纲面板' },
    ],
  },
  {
    title: '文件浏览器',
    items: [
      { keys: ['↑', '↓'], label: '导航文件' },
      { keys: ['Enter'], label: '打开文件 / 进入目录' },
      { keys: ['Delete'], label: '删除文件' },
      { keys: ['F2'], label: '重命名文件' },
      { keys: ['Home'], label: '跳转到第一个文件' },
      { keys: ['End'], label: '跳转到最后一个文件' },
    ],
  },
];

function Kbd({ keys }: { keys: string[] }) {
  return (
    <span className="shortcut-keys">
      {keys.map((k, i) => (
        <span key={i}>
          <kbd className="shortcut-key">{k}</kbd>
          {i < keys.length - 1 && <span className="shortcut-plus">+</span>}
        </span>
      ))}
    </span>
  );
}

export function ShortcutsPanel() {
  const setShortcutsOpen = useEditorStore((s) => s.setShortcutsOpen);

  return (
    <div className="dialog-overlay" onClick={() => setShortcutsOpen(false)}>
      <div className="dialog shortcuts-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h2>快捷键</h2>
          <button className="dialog-close" onClick={() => setShortcutsOpen(false)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div className="dialog-body shortcuts-body">
          {GROUPS.map((group) => (
            <div key={group.title} className="shortcuts-group">
              <h3 className="shortcuts-group-title">{group.title}</h3>
              <div className="shortcuts-items">
                {group.items.map((item) => (
                  <div key={item.label} className="shortcuts-row">
                    <span className="shortcuts-label">{item.label}</span>
                    <Kbd keys={item.keys} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="dialog-footer">
          <button className="btn btn-primary" onClick={() => setShortcutsOpen(false)}>关闭</button>
        </div>
      </div>
    </div>
  );
}
