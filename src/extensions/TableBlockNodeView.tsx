import { useCallback, useEffect, useRef, useState } from 'react';
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { TextSelection } from '@tiptap/pm/state';

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
    mdLines.push('| ' + allRows[0].join(' | ') + ' |');
    mdLines.push('| ' + allRows[0].map(() => '---').join(' | ') + ' |');
    for (let i = 1; i < allRows.length; i++) {
      mdLines.push('| ' + allRows[i].join(' | ') + ' |');
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
      const cellCount = lines[0].split('|').slice(1, -1).length;
      lines.push('| ' + Array(cellCount).fill('---').join(' | ') + ' |');
    }

    const headerCells = lines[0].split('|').slice(1, -1).map(s => s.trim());
    const dataRows = lines.slice(2).map(l =>
      l.split('|').slice(1, -1).map(s => s.trim())
    );

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
      <button className="table-edit-source-btn" onClick={handleToggleSource} title="编辑源码">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
      </button>
      <NodeViewContent />
    </NodeViewWrapper>
  );
}
