import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';

export interface Cursor {
  row: number;
  col: number;
}

interface Snapshot {
  lines: string[];
  cursor: Cursor;
}

interface EditorState {
  lines: string[];
  cursor: Cursor;
  goalCol: number;
  scrollOffset: number;
  undoStack: Snapshot[];
  redoStack: Snapshot[];
  killBuffer: string;
  dirty: boolean;
  showDiscardPrompt: boolean;

  // Lifecycle
  init: (content: string) => void;
  destroy: () => void;
  getContent: () => string;
}

const initialState = {
  lines: [''] as string[],
  cursor: { row: 0, col: 0 } as Cursor,
  goalCol: 0,
  scrollOffset: 0,
  undoStack: [] as Snapshot[],
  redoStack: [] as Snapshot[],
  killBuffer: '',
  dirty: false,
  showDiscardPrompt: false,
};

export const editorStore = createStore<EditorState>((set, get) => ({
  ...initialState,

  init: (content: string) => {
    const lines = content ? content.split('\n') : [''];
    set({
      ...initialState,
      lines,
      cursor: { row: 0, col: 0 },
      goalCol: 0,
      undoStack: [],
      redoStack: [],
    });
  },

  destroy: () => {
    set({ ...initialState });
  },

  getContent: () => get().lines.join('\n'),
}));

export function useEditorStore<T>(selector: (state: EditorState) => T): T {
  return useStore(editorStore, selector);
}
