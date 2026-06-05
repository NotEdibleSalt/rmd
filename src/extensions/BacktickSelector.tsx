import { useEffect, useRef, useState, useCallback } from 'react';
import { TextSelection } from '@tiptap/pm/state';
import { getEditorInstance } from '../editor-ref';
import { subscribe, getPending, hideSelector } from './backtickSelectorPlugin';

export const CODE_LANGUAGES = [
  'javascript', 'typescript', 'python', 'rust',
  'html', 'css', 'json', 'markdown',
  'bash', 'sql', 'yaml', 'toml',
  'java', 'go', 'c', 'cpp',
  'csharp', 'php', 'ruby', 'swift',
  'kotlin', 'dart', 'lua', 'perl',
  'r', 'scala', 'shell', 'graphql',
  'dockerfile', 'xml',
];

const RECENT_LANGS_KEY = 'rmd_recent_code_langs';
const MAX_RECENT = 5;

function loadRecentLangs(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_LANGS_KEY) || '[]');
  } catch { return []; }
}

function saveRecentLangs(langs: string[]) {
  localStorage.setItem(RECENT_LANGS_KEY, JSON.stringify(langs.slice(0, MAX_RECENT)));
}

const CHART_TYPES = [
  { label: 'graph TD',         desc: '流程图',    template: 'graph TD\n    A[开始] --> B[结束]' },
  { label: 'sequenceDiagram',  desc: '时序图',    template: 'sequenceDiagram\n    Alice->>John: 你好\n    John-->>Alice: 嗨！' },
  { label: 'gantt',            desc: '甘特图',    template: 'gantt\n    title 项目计划\n    dateFormat  YYYY-MM-DD\n    section 阶段A\n    任务1 :a1, 2024-01-01, 30d\n    任务2 :after a1, 20d' },
  { label: 'classDiagram',     desc: '类图',      template: 'classDiagram\n    class Animal {\n        +name: string\n        +move(): void\n    }\n    class Dog {\n        +bark(): void\n    }\n    Animal <|-- Dog' },
  { label: 'xychart-beta(line)', desc: '折线图',    template: 'xychart-beta\n    title "月度趋势"\n    x-axis ["1月", "2月", "3月", "4月", "5月", "6月"]\n    y-axis "数值" 0 --> 100\n    line [10, 25, 40, 55, 70, 85]' },
  { label: 'xychart-beta',     desc: 'XY 图表',   template: 'xychart-beta\n    title "销售额"\n    x-axis ["Q1", "Q2", "Q3", "Q4"]\n    y-axis "金额" 0 --> 100\n    bar [25, 40, 55, 80]' },
  { label: 'pie',              desc: '饼图',      template: 'pie title 数据分布\n    "类别 A" : 45\n    "类别 B" : 30\n    "类别 C" : 25' },
];

type Step = 'main' | 'code-lang' | 'chart-types';

export function BacktickSelector() {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [step, setStep] = useState<Step>('main');
  const [focusIndex, setFocusIndex] = useState(0);
  const [langFilter, setLangFilter] = useState('');
  // Language items visible in the code-lang grid, for keyboard navigation
  const recentLangs = loadRecentLangs();
  const q = (l: string) => l.toLowerCase().includes(langFilter.toLowerCase());
  const codeLangRecentItems = recentLangs.filter(q);
  const codeLangRestItems = CODE_LANGUAGES.filter(l => !recentLangs.includes(l) && q(l));
  const codeLangItems = [...codeLangRecentItems, ...codeLangRestItems];

  // Reset focus when filter changes so focusIndex stays within bounds
  useEffect(() => {
    setFocusIndex(0);
  }, [langFilter]);

  const listRef = useRef<HTMLDivElement>(null);

  // Subscribe to show/hide state from the ProseMirror plugin
  useEffect(() => {
    return subscribe(() => {
      const pending = getPending();
      setPos(pending ? { top: pending.top, left: pending.left } : null);
    });
  }, []);

  // Reset step & focus whenever selector is dismissed or re-shown
  useEffect(() => {
    if (!pos) setStep('main');
  }, [pos]);

  // Reset focus index when step changes
  useEffect(() => {
    setFocusIndex(0);
  }, [step]);

  // Auto-focus the active item whenever selector appears or step toggles
  useEffect(() => {
    if (!pos) return;
    requestAnimationFrame(() => {
      if (step === 'code-lang') {
        // Focus the filter input for immediate typing
        listRef.current?.querySelector<HTMLInputElement>('.bt-lang-input')?.focus();
      } else {
        const btn = listRef.current?.querySelector<HTMLButtonElement>('.backtick-selector-btn');
        btn?.focus();
      }
    });
  }, [pos, step]);

  // ─── Keyboard navigation ───

  useEffect(() => {
    if (!pos) return;

    const handler = (e: KeyboardEvent) => {
      const items = listRef.current?.querySelectorAll<HTMLButtonElement>(
        '.backtick-selector-btn, .bt-lang-btn',
      );
      if (!items || items.length === 0) return;

      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault();
          const next = Math.min(focusIndex + 1, items.length - 1);
          setFocusIndex(next);
          items[next]?.focus();
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          const prev = Math.max(focusIndex - 1, 0);
          setFocusIndex(prev);
          items[prev]?.focus();
          break;
        }
        case 'ArrowLeft': {
          if (step === 'chart-types' || step === 'code-lang') {
            e.preventDefault();
            setStep('main');
          }
          break;
        }
        case 'Enter': {
          e.preventDefault();
          if (step === 'main') {
            if (focusIndex === 0) {
              setStep('code-lang');
            } else {
              setStep('chart-types');
            }
          } else if (step === 'code-lang') {
            if (focusIndex === 0) {
              setStep('main');
            } else {
              const lang = codeLangItems[focusIndex - 1];
              if (lang) insertCodeBlock(lang);
            }
          } else {
            if (focusIndex === 0) {
              setStep('main');
            } else {
              insertMermaid(CHART_TYPES[focusIndex - 1].template);
            }
          }
          break;
        }
        case 'Escape': {
          e.preventDefault();
          if (step === 'chart-types' || step === 'code-lang') {
            setStep('main');
          } else {
            dismiss();
          }
          break;
        }
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos, step, focusIndex]);

  const dismiss = useCallback(() => {
    hideSelector();
    setStep('main');
    getEditorInstance()?.view.focus();
  }, []);

  const insertCodeBlock = useCallback((language?: string) => {
    const editor = getEditorInstance();
    if (!editor) { hideSelector(); return; }

    const { doc, selection } = editor.state;
    const $pos = doc.resolve(selection.from);
    const backtickStart = selection.from - 2;
    const beforeSlice = doc.slice($pos.start(), backtickStart);

    if (beforeSlice.content.size > 0) {
      // Paragraph has content before the `` trigger (e.g. text + hardBreak + ``).
      // Preserve that content and insert the codeBlock as a sibling after it.
      editor
        .chain()
        .focus()
        .command(({ tr, dispatch }) => {
          if (!dispatch) return true;
          const schema = tr.doc.type.schema;
          // Trim trailing hardBreaks — the final Enter that produced `` is part
          // of the trigger gesture, not content the user intended to keep.
          const hardBreakType = schema.nodes.hardBreak;
          let content = beforeSlice.content;
          while (content.lastChild?.type === hardBreakType) {
            content = content.cut(0, content.size - content.lastChild.nodeSize);
          }
          const preservedPara = schema.nodes.paragraph.create({}, content);
          const codeBlock = schema.nodes.codeBlock.create(
            language ? { language } : undefined,
          );
          tr.replaceWith($pos.before(), $pos.after(), [preservedPara, codeBlock]);
          dispatch(tr);
          return true;
        })
        .run();
    } else {
      // Empty paragraph — simple replacement
      editor
        .chain()
        .focus()
        .deleteRange({ from: $pos.start(), to: $pos.end() })
        .setCodeBlock(language ? { language } : undefined)
        .run();
    }

    const recent = loadRecentLangs();
    if (language && !recent.includes(language)) {
      saveRecentLangs([language, ...recent]);
    }

    hideSelector();
  }, []);

  const insertMermaid = useCallback((template: string) => {
    const editor = getEditorInstance();
    if (!editor) { hideSelector(); return; }

    const { doc, selection } = editor.state;
    const $pos = doc.resolve(selection.from);

    editor
      .chain()
      .focus()
      .deleteRange({ from: $pos.start(), to: $pos.end() })
      .command(({ tr, dispatch }) => {
        const $p = tr.doc.resolve(tr.selection.from);
        const mermaidType = tr.doc.type.schema.nodes.mermaid;
        const before = $p.before();
        const after = $p.after();
        const node = mermaidType.create({ content: template });
        tr.replaceRangeWith(before, after, node);
        tr.setSelection(TextSelection.near(tr.doc.resolve(before + node.nodeSize)));
        if (dispatch) dispatch(tr);
        return true;
      })
      .run();

    hideSelector();
  }, []);

  if (!pos) return null;

  return (
    <>
      <div className="backtick-overlay" onClick={dismiss} />
      <div
        className="backtick-selector"
        ref={listRef}
        style={{ top: pos.top, left: pos.left }}
      >
        {step === 'main' ? renderMain() : step === 'code-lang' ? renderCodeLang() : renderChartTypes()}
      </div>
    </>
  );

  function renderMain() {
    return (
      <>
        <button className="backtick-selector-btn" onClick={() => setStep('code-lang')}>
          <code className="bt-sel-icon">{'</>'}</code>
          <span className="bt-sel-label">代码块</span>
        </button>
        <div className="bt-sel-divider" />
        <button
          className="backtick-selector-btn"
          onClick={() => setStep('chart-types')}
        >
          <span className="bt-sel-icon bt-sel-icon-mermaid">◆</span>
          <span className="bt-sel-label">Mermaid 图表</span>
        </button>
      </>
    );
  }

  function renderCodeLang() {
    const recentLangs = loadRecentLangs();
    const isFiltering = langFilter.length > 0;
    const q = (l: string) => l.toLowerCase().includes(langFilter.toLowerCase());
    const recentItems = recentLangs.filter(q);
    const restItems = CODE_LANGUAGES.filter(l => !recentLangs.includes(l) && q(l));

    return (
      <>
        <button className="backtick-selector-btn bt-sel-back" onClick={() => setStep('main')}>
          <span className="bt-sel-icon">←</span>
          <span className="bt-sel-label">返回</span>
        </button>
        <div className="bt-sel-divider" />
        <div style={{ padding: '4px 8px' }}>
          <input
            type="text"
            className="bt-lang-input"
            placeholder="输入语言名，回车确认..."
            autoFocus
            value={langFilter}
            onChange={(e) => setLangFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.stopPropagation();
                const val = e.currentTarget.value.trim();
                if (val) insertCodeBlock(val);
              }
            }}
          />
        </div>
        <div className="bt-sel-divider" />
        <div className="bt-lang-grid">
          {recentItems.map((lang) => (
            <button key={lang} className="bt-lang-btn" onClick={() => insertCodeBlock(lang)}>
              {lang}
            </button>
          ))}
          {!isFiltering && recentItems.length > 0 && restItems.length > 0 && (
            <div className="bt-lang-separator">所有语言</div>
          )}
          {restItems.map((lang) => (
            <button key={lang} className="bt-lang-btn" onClick={() => insertCodeBlock(lang)}>
              {lang}
            </button>
          ))}
        </div>
      </>
    );
  }

  function renderChartTypes() {
    return (
      <>
        <button
          className="backtick-selector-btn bt-sel-back"
          onClick={() => setStep('main')}
        >
          <span className="bt-sel-icon">←</span>
          <span className="bt-sel-label">返回</span>
        </button>
        <div className="bt-sel-divider" />
        {CHART_TYPES.map((ct) => (
          <button
            key={ct.label}
            className="backtick-selector-btn bt-sel-chart-btn"
            onClick={() => insertMermaid(ct.template)}
          >
            <code className="bt-sel-icon bt-sel-chart-label">{ct.label}</code>
            <span className="bt-sel-chart-desc">{ct.desc}</span>
          </button>
        ))}
      </>
    );
  }
}
