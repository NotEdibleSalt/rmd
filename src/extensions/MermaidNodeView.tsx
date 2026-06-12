import { useCallback, useEffect, useRef, useState } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { getEditorInstance } from '../editor-ref';

function getMermaidTheme() {
  const style = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) =>
    style.getPropertyValue(name).trim() || fallback;

  // Read 12-color palette from CSS theme variables (fallbacks = light theme)
  const cp = (i: number) =>
    v(`--chart-color-${i}`,
      ['#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6','#1abc9c',
       '#e67e22','#2980b9','#27ae60','#d35400','#8e44ad','#16a085'][i-1]);

  return {
    theme: 'base' as const,
    themeVariables: {
      // --- General / Structural ---
      background: v('--bg-primary', '#ffffff'),
      mainBkg: v('--bg-panel', '#ffffff'),
      primaryColor: v('--accent', '#4f6ef7'),
      primaryTextColor: v('--text-primary', '#1a1a2e'),
      primaryBorderColor: v('--border-color', '#e0e0e0'),
      lineColor: v('--text-muted', '#999'),
      secondaryColor: v('--bg-secondary', '#f8f9fa'),
      tertiaryColor: v('--bg-tertiary', '#f0f0f0'),
      nodeBorder: v('--border-color', '#e0e0e0'),
      clusterBkg: v('--bg-secondary', '#f8f9fa'),
      clusterBorder: v('--border-color', '#e0e0e0'),
      titleColor: v('--text-primary', '#1a1a2e'),
      edgeLabelBackground: v('--bg-panel', '#ffffff'),
      nodeTextColor: v('--text-primary', '#1a1a2e'),

      // --- Pie chart (uses 12-color palette via pie1-pie12 for per-sector colors) ---
      pie1: cp(1),  pie2: cp(2),  pie3: cp(3),
      pie4: cp(4),  pie5: cp(5),  pie6: cp(6),
      pie7: cp(7),  pie8: cp(8),  pie9: cp(9),
      pie10: cp(10), pie11: cp(11), pie12: cp(12),
      pieStroke: v('--border-color', '#e0e0e0'),
      pieTitleTextColor: v('--text-primary', '#1a1a2e'),
      pieSectionTextColor: v('--text-primary', '#1a1a2e'),

      // --- Sequence diagram ---
      actorBkg: v('--bg-secondary', '#f8f9fa'),
      actorBorder: v('--border-color', '#e0e0e0'),
      actorTextColor: v('--text-primary', '#1a1a2e'),
      actorLineColor: v('--border-color', '#e0e0e0'),
      signalColor: v('--text-muted', '#999'),
      signalTextColor: v('--text-primary', '#1a1a2e'),
      labelBoxBkgColor: v('--bg-secondary', '#f8f9fa'),
      labelBoxBorderColor: v('--accent', '#4f6ef7'),

      // --- Class diagram ---
      classText: v('--text-primary', '#1a1a2e'),
      classTextSecondary: v('--text-secondary', '#666'),
      classBkg: v('--bg-secondary', '#f8f9fa'),
      classBorder: v('--border-color', '#e0e0e0'),

      // --- State diagram ---
      stateLabelColor: v('--text-primary', '#1a1a2e'),
      stateBkg: v('--bg-secondary', '#f8f9fa'),
      stateBorder: v('--border-color', '#e0e0e0'),

      // --- Gantt chart ---
      taskBkg: v('--accent-light', '#eef1ff'),
      taskBorder: v('--accent', '#4f6ef7'),
      taskTextColor: v('--text-primary', '#1a1a2e'),
      taskTextOutsideColor: v('--text-secondary', '#666'),
      activeTaskBkg: v('--accent', '#4f6ef7'),
      activeTaskBorder: v('--accent-hover', '#3b5de7'),
      gridColor: v('--border-color', '#e0e0e0'),
      todayLineColor: v('--accent', '#4f6ef7'),

      // --- ER diagram ---
      entityBkg: v('--bg-panel', '#ffffff'),
      entityBorder: v('--border-color', '#e0e0e0'),
      entityTextColor: v('--text-primary', '#1a1a2e'),
      attributeBkg: v('--bg-secondary', '#f8f9fa'),
      attributeBorder: v('--border-color', '#e0e0e0'),
      attributeTextColor: v('--text-primary', '#1a1a2e'),
    },
  };
}

export function MermaidNodeView({ node, updateAttributes, selected }: NodeViewProps) {
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(true);
  const [code, setCode] = useState(node.attrs.content || '');
  const codeRef = useRef(code);
  codeRef.current = code;
  const renderIdRef = useRef(0);
  const mermaidRef = useRef<any>(null);

  // Lazy import mermaid
  useEffect(() => {
    let cancelled = false;
    import('mermaid').then((mod) => {
      if (!cancelled) {
        mermaidRef.current = mod;
        mod.default.initialize({ startOnLoad: false, htmlLabels: false, ...getMermaidTheme() });
        renderDiagram(code);
      }
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-render when editor theme changes (uses codeRef to avoid re-creating observer on every keystroke)
  useEffect(() => {
    const html = document.documentElement;
    const observer = new MutationObserver(() => {
      if (mermaidRef.current) {
        mermaidRef.current.default.initialize({ startOnLoad: false, htmlLabels: false, ...getMermaidTheme() });
        renderDiagram(codeRef.current);
      }
    });
    observer.observe(html, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const renderDiagram = useCallback(async (source: string) => {
    if (!mermaidRef.current) {
      setSvg('');
      return;
    }
    const id = ++renderIdRef.current;
    const uid = `mermaid-${Date.now()}-${id}`;
    try {
      setError(null);
      const { svg: svgStr } = await mermaidRef.current.default.render(uid, source);
      if (id === renderIdRef.current) {
        setSvg(svgStr);
      }
    } catch (e: any) {
      if (id === renderIdRef.current) {
        setError(e?.message || String(e));
        setSvg('');
      }
    }
  }, []);

  // Debounced re-render on code change
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleCodeChange = useCallback((value: string) => {
    setCode(value);
    updateAttributes({ content: value });
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => renderDiagram(value), 300);
  }, [updateAttributes, renderDiagram]);

  // Sync external changes when node gets selected
  useEffect(() => {
    if (selected && node.attrs.content !== code) {
      setCode(node.attrs.content);
      renderDiagram(node.attrs.content);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  if (!editing) {
    return (
      <NodeViewWrapper
        className="mermaid-node"
        data-selected={selected ? 'true' : undefined}
        onClick={() => setEditing(true)}
        onKeyDown={() => {}}
        role="button"
        tabIndex={0}
      >
        {svg ? (
          <div className="mermaid-preview" dangerouslySetInnerHTML={{ __html: svg }} />
        ) : (
          <div className="mermaid-preview mermaid-loading">Loading Mermaid...</div>
        )}
        {error && <div className="mermaid-error">{error}</div>}
        <div className="mermaid-edit-btn" title="编辑图表">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </div>
        {selected && (
          <div className="mermaid-toolbar">
            <button
              className="mermaid-toolbar-btn"
              title="刷新"
              onClick={(e) => { e.stopPropagation(); renderDiagram(code); }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
              </svg>
            </button>
            <button
              className="mermaid-toolbar-btn"
              title="复制代码"
              onClick={(e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(node.attrs.content || '');
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            </button>
            <button
              className="mermaid-toolbar-btn"
              title="删除"
              onClick={(e) => {
                e.stopPropagation();
                const editor = getEditorInstance();
                if (editor) {
                  editor.chain().focus().deleteSelection().run();
                }
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
            </button>
          </div>
        )}
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className="mermaid-node" data-editing="true" data-selected={selected ? 'true' : undefined}>
      <textarea
        className="mermaid-code-editor"
        value={code}
        onChange={(e) => handleCodeChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Tab') {
            e.preventDefault();
            const start = e.currentTarget.selectionStart;
            const end = e.currentTarget.selectionEnd;
            const newVal = code.substring(0, start) + '    ' + code.substring(end);
            handleCodeChange(newVal);
            requestAnimationFrame(() => {
              e.currentTarget.selectionStart = e.currentTarget.selectionEnd = start + 4;
            });
          }
          if (e.key === 'Escape') {
            setEditing(false);
            e.currentTarget.blur();
          }
        }}
        onBlur={() => setEditing(false)}
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        placeholder="在此输入 Mermaid 图表代码..."
        rows={Math.max(3, code.split('\n').length)}
      />
      {error && <div className="mermaid-error">{error}</div>}
      {!code.trim() && (
        <div className="mermaid-hints">
          <span className="mermaid-hints-label">快速插入：</span>
          {HINTS.map((h) => (
            <button
              key={h.label}
              className="mermaid-hint-btn"
              onClick={() => handleCodeChange(h.template)}
              title={h.desc}
            >
              {h.label}
            </button>
          ))}
        </div>
      )}
      {svg ? (
        <div className="mermaid-preview" dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <div className="mermaid-preview mermaid-loading">Loading Mermaid...</div>
      )}
    </NodeViewWrapper>
  );
}

const HINTS = [
  { label: 'graph TD', desc: '流程图', template: 'graph TD\n    A[开始] --> B[结束]' },
  { label: 'sequenceDiagram', desc: '时序图', template: 'sequenceDiagram\n    Alice->>John: 你好\n    John-->>Alice: 嗨！' },
  { label: 'pie', desc: '饼图', template: 'pie title 数据分布\n    "类别 A" : 45\n    "类别 B" : 30\n    "类别 C" : 25' },
  { label: 'xychart-beta', desc: 'XY 图表', template: 'xychart-beta\n    title "销售额"\n    x-axis ["Q1", "Q2", "Q3", "Q4"]\n    y-axis "金额" 0 --> 100\n    bar [25, 40, 55, 80]' },
  { label: 'gantt', desc: '甘特图', template: 'gantt\n    title 项目计划\n    dateFormat  YYYY-MM-DD\n    section 阶段A\n    任务1 :a1, 2024-01-01, 30d\n    任务2 :after a1, 20d' },
  { label: 'classDiagram', desc: '类图', template: 'classDiagram\n    class Animal {\n        +name: string\n        +move(): void\n    }\n    class Dog {\n        +bark(): void\n    }\n    Animal <|-- Dog' },
];
