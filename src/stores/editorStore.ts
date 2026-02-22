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

  // Navigation
  moveCursorTo: (row: number, col: number) => void;

  // Editing
  insertChar: (char: string) => void;
  insertNewline: () => void;
  deleteBefore: () => void;
  deleteAt: () => void;
}

const MAX_UNDO = 50;

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

  moveCursorTo: (row: number, col: number) => {
    set({ cursor: { row, col } });
  },

  insertChar: (char: string) => {
    const { lines, cursor, undoStack } = get();
    const newUndo = [
      ...undoStack.slice(-(MAX_UNDO - 1)),
      { lines: [...lines], cursor: { ...cursor } },
    ];
    const line = lines[cursor.row]!;
    const newLine = line.slice(0, cursor.col) + char + line.slice(cursor.col);
    const newLines = [...lines];
    newLines[cursor.row] = newLine;
    set({
      lines: newLines,
      cursor: { row: cursor.row, col: cursor.col + 1 },
      undoStack: newUndo,
      redoStack: [],
      dirty: true,
    });
  },

  insertNewline: () => {
    const { lines, cursor, undoStack } = get();
    const newUndo = [
      ...undoStack.slice(-(MAX_UNDO - 1)),
      { lines: [...lines], cursor: { ...cursor } },
    ];
    const line = lines[cursor.row]!;
    const before = line.slice(0, cursor.col);
    const after = line.slice(cursor.col);
    const newLines = [...lines];
    newLines.splice(cursor.row, 1, before, after);
    set({
      lines: newLines,
      cursor: { row: cursor.row + 1, col: 0 },
      undoStack: newUndo,
      redoStack: [],
      dirty: true,
    });
  },

  deleteBefore: () => {
    const { lines, cursor, undoStack } = get();
    if (cursor.col === 0 && cursor.row === 0) return;
    const newUndo = [
      ...undoStack.slice(-(MAX_UNDO - 1)),
      { lines: [...lines], cursor: { ...cursor } },
    ];
    const newLines = [...lines];
    if (cursor.col > 0) {
      const line = newLines[cursor.row]!;
      newLines[cursor.row] =
        line.slice(0, cursor.col - 1) + line.slice(cursor.col);
      set({
        lines: newLines,
        cursor: { row: cursor.row, col: cursor.col - 1 },
        undoStack: newUndo,
        redoStack: [],
        dirty: true,
      });
    } else {
      // col === 0, row > 0: join with previous line
      const prevLine = newLines[cursor.row - 1]!;
      const curLine = newLines[cursor.row]!;
      const joinCol = prevLine.length;
      newLines[cursor.row - 1] = prevLine + curLine;
      newLines.splice(cursor.row, 1);
      set({
        lines: newLines,
        cursor: { row: cursor.row - 1, col: joinCol },
        undoStack: newUndo,
        redoStack: [],
        dirty: true,
      });
    }
  },

  deleteAt: () => {
    const { lines, cursor, undoStack } = get();
    const line = lines[cursor.row]!;
    if (cursor.col < line.length) {
      const newUndo = [
        ...undoStack.slice(-(MAX_UNDO - 1)),
        { lines: [...lines], cursor: { ...cursor } },
      ];
      const newLines = [...lines];
      newLines[cursor.row] =
        line.slice(0, cursor.col) + line.slice(cursor.col + 1);
      set({
        lines: newLines,
        cursor: { ...cursor },
        undoStack: newUndo,
        redoStack: [],
        dirty: true,
      });
    } else if (cursor.row < lines.length - 1) {
      const newUndo = [
        ...undoStack.slice(-(MAX_UNDO - 1)),
        { lines: [...lines], cursor: { ...cursor } },
      ];
      const newLines = [...lines];
      newLines[cursor.row] = line + newLines[cursor.row + 1]!;
      newLines.splice(cursor.row + 1, 1);
      set({
        lines: newLines,
        cursor: { ...cursor },
        undoStack: newUndo,
        redoStack: [],
        dirty: true,
      });
    }
    // else: end of document, do nothing
  },
}));

export function useEditorStore<T>(selector: (state: EditorState) => T): T {
  return useStore(editorStore, selector);
}
