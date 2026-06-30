import { useCallback, useEffect, useRef, useState } from 'react';
import { NodeViewContent, NodeViewWrapper, type NodeViewProps, type Editor } from '@tiptap/react';
import { TextSelection } from '@tiptap/pm/state';
import { getEditorInstance } from '../editor-ref';

// ponytail: handle \| in cell content without full GFM parser
const PIPE_ESC = '\0PIPE\0';
function splitCells(row: string): string[] {
  const prepped = row.replace(/\\\|/g, PIPE_ESC);
  return prepped.split('|').slice(1, -1).map(s => s.trim().replace(/\0PIPE\0/g, '|'));
}
function escapeCells(text: string): string {
  return text.replace(/\|/g, '\\|');
}

export function TableBlockNodeView({ node, view, getPos, updateAttributes }: NodeViewProps) {
  const [sourceMd, setSourceMd] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const isSourceMode = node.attrs.isEditingSource as boolean;

  // Serialize current ProseMirror table node to GFM markdown
  const tableToMd = useCallback((): string => {
    const headers: string[] = [];
    const rows: string[][] = [];

    (node as any).forEach((row: any) => {
      const cells: string[] = [];
      row.forEach((cell: any) => {
        let text = '';
        cell.descendants((child: any) => {
          if (child.isText) text += child.text;
        });
        cells.push(text);
      });
      if (row.type.name === 'tableHeader') {
        headers.push(...cells);
      } else {
        rows.push(cells);
      }
    });

    const allRows = headers.length > 0 ? [headers, ...rows] : rows;
    if (allRows.length === 0) return '';

    const mdLines: string[] = [];
    mdLines.push('| ' + allRows[0].map(escapeCells).join(' | ') + ' |');
    mdLines.push('| ' + allRows[0].map(() => '---').join(' | ') + ' |');
    for (let i = 1; i < allRows.length; i++) {
      mdLines.push('| ' + allRows[i].map(escapeCells).join(' | ') + ' |');
    }
    return mdLines.join('\n');
  }, [node]);

  const handleToggleSource = useCallback(() => {
    if (isSourceMode) return;
    const md = tableToMd();
    setSourceMd(md);
    updateAttributes({ isEditingSource: true, sourceMd: md });
  }, [isSourceMode, tableToMd, updateAttributes]);

  // Auto-save textarea content to node attribute (debounced)
  const handleSourceChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setSourceMd(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const pos = getPos();
      if (pos === undefined) return;
      view.dispatch(view.state.tr.setNodeAttribute(pos, 'sourceMd', value));
    }, 500);
  }, [view, getPos]);

  // Save and return: parse markdown, render table, exit source mode
  const handleSaveAndReturn = useCallback(() => {
    const pos = getPos();
    if (pos === undefined) return;
    const schema = view.state.schema;

    const lines = sourceMd.trim().split('\n').filter(l => l.trim().startsWith('|'));

    // If no valid table lines, delete the table and insert an empty paragraph
    if (lines.length === 0) {
      const emptyPara = schema.nodes.paragraph.create();
      const tr = view.state.tr.replaceWith(pos, pos + (node as any).nodeSize, emptyPara);
      tr.setSelection(TextSelection.create(tr.doc, pos + 1));
      view.dispatch(tr);
      return;
    }

    // Ensure at least header + separator line
    if (lines.length === 1) {
      const cellCount = splitCells(lines[0]).length;
      lines.push('| ' + Array(cellCount).fill('---').join(' | ') + ' |');
    }

    const headerCells = splitCells(lines[0]);
    const dataRows = lines.slice(2).map(splitCells);

    const createCellContent = (text: string) =>
      text
        ? schema.nodes.paragraph.create(null, [schema.text(text)])
        : schema.nodes.paragraph.create(null, []);

    const headerRow = schema.nodes.tableRow.create(
      null,
      headerCells.map((text) =>
        schema.nodes.tableHeader.create(null, [createCellContent(text)])
      )
    );
    const bodyRows = dataRows.map((cells) =>
      schema.nodes.tableRow.create(
        null,
        cells.map((text) =>
          schema.nodes.tableCell.create(null, [createCellContent(text)])
        )
      )
    );
    const newTable = schema.nodes.table.create(
      { withHeaderRow: true },
      [headerRow, ...bodyRows]
    );

    const tr = view.state.tr.replaceRangeWith(pos, pos + (node as any).nodeSize, newTable);
    view.dispatch(tr);
    // New NodeView created with default isEditingSource: false
  }, [sourceMd, view, node, getPos]);

  // Row/col operations via the TipTap table commands
  const runTableCommand = useCallback((cmd: (e: Editor) => void) => {
    const editor = getEditorInstance();
    if (!editor) return;
    editor.chain().focus().run();
    cmd(editor);
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  if (isSourceMode) {
    return (
      <NodeViewWrapper className="table-block-source">
        <textarea
          className="table-source-editor"
          value={sourceMd || ((node.attrs.sourceMd as string) || '')}
          onChange={handleSourceChange}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
        />
        <div className="table-source-actions">
          <button className="btn" onClick={handleSaveAndReturn}>返回</button>
        </div>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className="table-block-wrapper">
      <div className="table-toolbar">
        <button className="table-toolbar-btn" title="上方插入行" onClick={() => runTableCommand(e => e.chain().focus().addRowBefore().run())}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
        <button className="table-toolbar-btn" title="下方插入行" onClick={() => runTableCommand(e => e.chain().focus().addRowAfter().run())}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
        <button className="table-toolbar-btn" title="删除行" onClick={() => runTableCommand(e => e.chain().focus().deleteRow().run())}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
        <div className="table-toolbar-sep" />
        <button className="table-toolbar-btn" title="左侧插入列" onClick={() => runTableCommand(e => e.chain().focus().addColumnBefore().run())}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
        <button className="table-toolbar-btn" title="右侧插入列" onClick={() => runTableCommand(e => e.chain().focus().addColumnAfter().run())}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
        <button className="table-toolbar-btn" title="删除列" onClick={() => runTableCommand(e => e.chain().focus().deleteColumn().run())}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
        <div className="table-toolbar-sep" />
        <button className="table-toolbar-btn" title="编辑源码" onClick={handleToggleSource}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
      </div>
      <NodeViewContent />
    </NodeViewWrapper>
  );
}
