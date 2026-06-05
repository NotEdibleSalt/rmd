import { Table } from '@tiptap/extension-table';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { TableBlockNodeView } from './TableBlockNodeView';

export const TableBlock = Table.extend({
  addAttributes() {
    return {
      sourceMd: {
        default: '',
      },
      isEditingSource: {
        default: false,
      },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(TableBlockNodeView);
  },
});
