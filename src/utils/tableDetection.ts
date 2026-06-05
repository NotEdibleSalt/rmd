import type { Editor } from '@tiptap/react';
import type { Schema, Node } from '@tiptap/pm/model';
import type { EditorState } from '@tiptap/pm/state';

export interface DetectedTable {
  from: number;
  to: number;
  headers: string[];
  rows: string[][];
}

export interface TableData {
  headers: string[];
  rows: string[][];
}

/** Check if text looks like a GFM table row (starts with `|`, has another `|` after index 1) */
function isTableRow(text: string): boolean {
  return text.startsWith('|') && text.indexOf('|', 1) !== -1;
}

/** Check if text is a GFM table separator row (all cells match `:?---+:?` pattern) */
function isTableSeparator(text: string): boolean {
  const cells = text.split('|').filter((c: string) => c.trim() !== '');
  return cells.length > 0 && cells.every((c: string) => /^:?-{3,}:?$/.test(c.trim()));
}

/** Parse a GFM table row, tolerating missing leading/trailing `|` */
function parseRow(text: string): string[] {
  let s = text.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map(c => c.trim());
}

/** Build a TipTap table node from parsed header/data rows */
export function buildTableFromData(
  schema: Schema,
  headers: string[],
  rows: string[][],
): Node {
  const createCell = (text: string, typeName: 'tableHeader' | 'tableCell') => {
    const content = text
      ? [schema.nodes.paragraph.create(null, [schema.text(text)])]
      : [schema.nodes.paragraph.create(null, [])];
    return schema.nodes[typeName].create(null, content);
  };

  const headerRow = schema.nodes.tableRow.create(
    null,
    headers.map(h => createCell(h, 'tableHeader')),
  );

  const bodyRows = rows.map(cells =>
    schema.nodes.tableRow.create(
      null,
      cells.map(c => createCell(c, 'tableCell')),
    ),
  );

  return schema.nodes.table.create({ withHeaderRow: true }, [headerRow, ...bodyRows]);
}

/**
 * Extract lines from a paragraph, respecting `<br>` (hardBreak) as line separators.
 *
 * ProseMirror's `Node.textContent` concatenates hardBreak leaf nodes without
 * any separator (`leafText` is null by default), so `textContent.split('\n')`
 * produces a single line for hardBreak-separated content. This function
 * manually iterates child nodes and inserts `\n` for each hardBreak.
 */
function getLinesFromParagraph(para: Node): string[] {
  const lines: string[] = [];
  let current = '';

  para.content.forEach(child => {
    if (child.type.name === 'hardBreak') {
      lines.push(current);
      current = '';
    } else {
      current += child.textContent;
    }
  });

  if (current !== '') {
    lines.push(current);
  }

  return lines;
}

/**
 * Core detection: check if the paragraph at `$pos` (depth 1, type paragraph)
 * contains a complete GFM table across its `<br>`-separated lines.
 *
 * Returns `{ from, to, headers, rows }` if found, `null` otherwise.
 */
function detectInParagraph($pos: import('@tiptap/pm/model').ResolvedPos): DetectedTable | null {
  const allLines = getLinesFromParagraph($pos.parent);

  // Walk backward from last line collecting consecutive table rows
  const collectedLines: string[] = [];
  for (let i = allLines.length - 1; i >= 0; i--) {
    const line = allLines[i].trim();
    if (!line) continue;
    if (!isTableRow(line)) break;
    collectedLines.unshift(line);
  }

  if (collectedLines.length < 2) return null;

  // Find the separator row
  let separatorIdx = -1;
  for (let i = 0; i < collectedLines.length; i++) {
    if (isTableSeparator(collectedLines[i])) {
      separatorIdx = i;
      break;
    }
  }

  if (separatorIdx <= 0 || separatorIdx >= collectedLines.length - 1) return null;

  const headers = parseRow(collectedLines[separatorIdx - 1]);
  const dataRows = collectedLines.slice(separatorIdx + 1).map(parseRow);
  if (headers.length === 0) return null;

  return {
    from: $pos.before(),
    to: $pos.after(),
    headers,
    rows: dataRows,
  };
}

/**
 * Detect a GFM table from the current cursor position within a single paragraph.
 * Convenience wrapper around `detectInParagraph` that takes a TipTap Editor.
 */
export function detectTableFromPos(editor: Editor): DetectedTable | null {
  const $pos = editor.state.doc.resolve(editor.state.selection.from);
  if ($pos.depth !== 1 || $pos.parent.type.name !== 'paragraph') return null;
  return detectInParagraph($pos);
}

/**
 * Detect a GFM table from the cursor position in a raw ProseMirror EditorState.
 * Used by ProseMirror Plugin `appendTransaction`.
 *
 * Skips paragraphs whose last non-empty text line doesn't end with `|`,
 * matching the core trigger: user inputs a `|` at the end of a line.
 */
export function detectTableAtState(state: EditorState): DetectedTable | null {
  const $pos = state.doc.resolve(state.selection.from);
  if ($pos.depth !== 1 || $pos.parent.type.name !== 'paragraph') return null;

  // Quick early exit: the last non-empty line must end with `|`.
  // This avoids running full table detection on every keystroke.
  const lines = getLinesFromParagraph($pos.parent);
  const lastNonEmptyLine = lines
    .filter(l => l.trim().length > 0)
    .pop();
  if (!lastNonEmptyLine || !lastNonEmptyLine.trim().endsWith('|')) return null;

  return detectInParagraph($pos);
}

/**
 * Detect a GFM table from plain text (clipboard paste).
 *
 * Every non-empty line must form a valid table:
 *   header row → separator row (|---|---|) → at least one data row.
 */
export function detectTableFromText(text: string): TableData | null {
  const lines = text
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);

  if (lines.length < 2) return null;

  let separatorIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (isTableSeparator(lines[i])) {
      separatorIdx = i;
      break;
    }
  }

  if (separatorIdx <= 0 || separatorIdx >= lines.length - 1) return null;

  // Verify all non-separator lines are actual table rows
  for (let i = 0; i < lines.length; i++) {
    if (i === separatorIdx) continue;
    if (!isTableRow(lines[i])) return null;
  }

  const headers = parseRow(lines[separatorIdx - 1]);
  const dataRows = lines.slice(separatorIdx + 1).map(parseRow);
  if (headers.length === 0) return null;

  return { headers, rows: dataRows };
}

/**
 * Replace the paragraph range with a rendered TipTap table node.
 */
export function insertTableAtPos(editor: Editor, detection: DetectedTable): void {
  const table = buildTableFromData(editor.state.schema, detection.headers, detection.rows);
  editor.view.dispatch(
    editor.state.tr.replaceWith(detection.from, detection.to, table),
  );
}
