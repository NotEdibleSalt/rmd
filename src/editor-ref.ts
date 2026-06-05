import type { Editor } from '@tiptap/react';

let editorInstance: Editor | null = null;

export function setEditorInstance(e: Editor | null) {
  editorInstance = e;
}

/** @internal exposed for testing / plugins */
export function getEditorInstance(): Editor | null {
  return editorInstance;
}
