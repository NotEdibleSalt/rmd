import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { keymap } from '@tiptap/pm/keymap';
import type { WorkspaceFile } from '../lib/workspaceIndex';
import { useEditorStore } from '../store';
import { getEditorInstance } from '../editor-ref';

// ─── Shared State (bridge between ProseMirror plugin and React component) ───

export interface PendingAutocomplete {
  query: string;
  from: number;
  to: number;
  top: number;
  left: number;
  suggestions: WorkspaceFile[];
}

let _pending: PendingAutocomplete | null = null;
const _listeners = new Set<() => void>();

export function getPending(): PendingAutocomplete | null {
  return _pending;
}

export function subscribe(fn: () => void): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

function notify() {
  _listeners.forEach((fn) => fn());
}

// Tracks which suggestion is focused (synced from React component)
// so the capture-phase keydown handler can insert the correct file.
let _pendingFocusIndex = 0;

export function setPendingFocusIndex(index: number) {
  _pendingFocusIndex = index;
}

export function hideAutocomplete() {
  if (_pending) {
    _pending = null;
    notify();
  }
}

// Match `[[<query>` immediately before the cursor.
// Excludes `[`, `]`, and newlines from the query so `[[Page]]` doesn't
// match (the `]]` closes the link) and the popup dismisses once the user
// types a closing bracket.
// The (?!\[) negative lookahead prevents matching on bracket chains
// (e.g. [[[Page) — matching there would leave a dangling [ after
// insertion and compound into [[[[Page]]]] on subsequent edits.
const WIKI_TRIGGER = /\[\[(?!\[)([^\[\]\n]*)$/;

// ─── TipTap Extension ───
// Detects `[[` text input in real time, shows a floating popup with
// fuzzy-matched workspace files, and replaces the trigger with a
// `[[Page]]`-shaped WikiLinkMark node on selection.

export const WikiLinkAutocompletePlugin = Extension.create({
  name: 'wikiLinkAutocomplete',

  addProseMirrorPlugins() {
    return [
      // Keymap plugin — placed FIRST so it fires before ANY
      // addKeyboardShortcuts keymaps (e.g. Enter → splitBlock from
      // @tiptap/extension-paragraph).  TipTap appends keymap plugins
      // AFTER all addProseMirrorPlugins() results, so this keymap is
      // checked first in ProseMirror's handleKeyDown pipeline.
      keymap({
        Enter: () => {
          if (_pending) {
            return true; // handled — skip splitBlock
          }
          return false;
        },
      }),
      new Plugin({
        key: new PluginKey('wikiLinkAutocomplete'),
        props: {
          handleKeyDown(_view, event) {
            // Backup guard in case the keymap plugin above doesn't fire
            // (should not happen, but belt-and-suspenders).
            if (event.key === 'Enter' && _pending) {
              return true;
            }
            return false;
          },
        },
        view(editorView) {
          // ── Capture-phase keydown handler ──
          // Fires BEFORE ProseMirror's own keydown handler (target phase),
          // intercepting Enter before the Paragraph extension's splitBlock
          // keymap can process it.  stopPropagation prevents the event
          // from ever reaching ProseMirror's event dispatch.
          const onCaptureKeydown = (e: KeyboardEvent) => {
            if (e.key === 'Enter' && _pending) {
              const file = _pending.suggestions[_pendingFocusIndex];
              if (!file) return; // nothing to insert — let event pass
              e.preventDefault();
              e.stopPropagation();
              insertSelection(file);
            }
          };
          editorView.dom.addEventListener(
            'keydown',
            onCaptureKeydown,
            true // capture phase
          );

          return {
            update(updatedView, prevState) {
              // Only react to doc or selection changes; ignore viewport/focus
              // churn. `view.docChanged` exists at runtime but is not part of
              // the public EditorView type definitions, so compare the doc
              // nodes directly to stay type-safe.
              if (
                prevState.doc === updatedView.state.doc &&
                prevState.selection.eq(updatedView.state.selection)
              ) {
                return;
              }

              const { from } = updatedView.state.selection;
              const $pos = updatedView.state.doc.resolve(from);
              const node = $pos.parent;

              // Only in paragraphs (mirrors the BacktickSelector restriction).
              if (node.type.name !== 'paragraph') {
                if (_pending) {
                  _pending = null;
                  notify();
                }
                return;
              }

              const textBefore = node.textBetween(0, $pos.parentOffset);
              const match = textBefore.match(WIKI_TRIGGER);
              if (!match) {
                if (_pending) {
                  _pending = null;
                  notify();
                }
                return;
              }

              const matchFrom = from - match[0].length;

              // If any position in the matched [[query range is inside an
              // existing wikiLink mark, the cursor is editing a previously-
              // converted WikiLinkMark.  Dismiss — showing the popup here
              // would let the user "complete" into an existing wikilink and
              // produce extra brackets (e.g. [[NewPage]]age ]] from a
              // [[Page]] wikilink whose [[Pa was deleted during insertion).
              let overlapsExistingWikiLink = false;
              for (let p = matchFrom; p <= from; p++) {
                const $c = updatedView.state.doc.resolve(Math.min(p, updatedView.state.doc.content.size));
                if ($c.marks().some((m) => m.type.name === 'wikiLink')) {
                  overlapsExistingWikiLink = true;
                  break;
                }
              }
              if (overlapsExistingWikiLink) {
                if (_pending) {
                  _pending = null;
                  notify();
                }
                return;
              }

              // If the matched [[ is immediately preceded by another [ in the
              // paragraph text, it's part of a bracket chain (e.g. [[[bb).
              // Insertion would leave a dangling [ behind, producing a
              // malformed wikilink after appendTransaction conversion.
              // match.index is always defined for a non-global RegExp match
              const matchIdx = match.index!;
              if (matchIdx > 0 && textBefore[matchIdx - 1] === '[') {
                if (_pending) {
                  _pending = null;
                  notify();
                }
                return;
              }

              const query = match[1];
              const coords = updatedView.coordsAtPos(from);
              const suggestions = useEditorStore
                .getState()
                .workspaceIndex.fuzzySearch(query, 10);

              _pending = {
                query,
                from: matchFrom,
                to: from,
                top: coords.bottom + 4,
                left: coords.left,
                suggestions,
              };
              notify();
            },
            destroy() {
              editorView.dom.removeEventListener(
                'keydown',
                onCaptureKeydown,
                true
              );
            },
          };
        },
      }),
    ];
  },
});

// ─── Insertion ───
// Replaces the `[[query` text in the doc with WikiLinkMark(target) only
// (no separate `[[` / `]]` text nodes).  The surrounding brackets are added
// by renderMarkdown on serialization.  This avoids a double-bracket
// feedback loop where separate bracket text nodes + renderMarkdown's own
// bracket output produce `[[[[Page]]]]` on every serialisation cycle.
// Cursor ends up after the inserted mark.

export function insertSelection(file: WorkspaceFile) {
  const editor = getEditorInstance();
  if (!editor || !_pending) {
    hideAutocomplete();
    return;
  }
  const { from, to } = _pending;

  // Safety: verify the range to be deleted actually starts with [[.
  // A stale _pending (e.g. from a previous cursor position) could
  // delete the wrong text and leave a dangling [ that produces
  // [[[Page]] on the next appendTransaction pass.
  const rangeText = editor.state.doc.textBetween(from, to);
  if (!rangeText.startsWith('[[')) {
    hideAutocomplete();
    return;
  }
  const target = file.name;
  const missing = !useEditorStore.getState().workspaceIndex.resolve(target);
  const { state } = editor;
  const { schema } = state;
  const markType = schema.marks.wikiLink;
  if (!markType) {
    hideAutocomplete();
    return;
  }

  const tr = state.tr;
  tr.delete(from, to);
  tr.insert(
    from,
    schema.text(target, [markType.create({ target, missing })])
  );
  tr.setSelection(
    TextSelection.create(tr.doc, from + target.length)
  );
  editor.view.dispatch(tr);
  hideAutocomplete();
}
