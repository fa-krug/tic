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
  initialContent: string;

  // Lifecycle
  init: (content: string) => void;
  destroy: () => void;
  getContent: () => string;

  // Navigation
  moveCursorTo: (row: number, col: number) => void;
  moveLeft: () => void;
  moveRight: () => void;
  moveUp: () => void;
  moveDown: () => void;
  moveToLineStart: () => void;
  moveToLineEnd: () => void;
  moveWordLeft: () => void;
  moveWordRight: () => void;

  // Editing
  insertChar: (char: string) => void;
  insertNewline: () => void;
  deleteBefore: () => void;
  deleteAt: () => void;

  // Undo/Redo
  undo: () => void;
  redo: () => void;
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
  initialContent: '',
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
      initialContent: content,
    });
  },

  destroy: () => {
    set({ ...initialState });
  },

  getContent: () => get().lines.join('\n'),

  moveCursorTo: (row: number, col: number) => {
    set({ cursor: { row, col }, goalCol: col });
  },

  moveLeft: () => {
    const { cursor, lines } = get();
    if (cursor.col > 0) {
      const col = cursor.col - 1;
      set({ cursor: { row: cursor.row, col }, goalCol: col });
    } else if (cursor.row > 0) {
      const row = cursor.row - 1;
      const col = lines[row]!.length;
      set({ cursor: { row, col }, goalCol: col });
    }
  },

  moveRight: () => {
    const { cursor, lines } = get();
    const lineLen = lines[cursor.row]!.length;
    if (cursor.col < lineLen) {
      const col = cursor.col + 1;
      set({ cursor: { row: cursor.row, col }, goalCol: col });
    } else if (cursor.row < lines.length - 1) {
      set({ cursor: { row: cursor.row + 1, col: 0 }, goalCol: 0 });
    }
  },

  moveUp: () => {
    const { cursor, lines, goalCol } = get();
    if (cursor.row > 0) {
      const newRow = cursor.row - 1;
      const col = Math.min(goalCol, lines[newRow]!.length);
      set({ cursor: { row: newRow, col } });
    }
  },

  moveDown: () => {
    const { cursor, lines, goalCol } = get();
    if (cursor.row < lines.length - 1) {
      const newRow = cursor.row + 1;
      const col = Math.min(goalCol, lines[newRow]!.length);
      set({ cursor: { row: newRow, col } });
    }
  },

  moveToLineStart: () => {
    const { cursor } = get();
    set({ cursor: { row: cursor.row, col: 0 }, goalCol: 0 });
  },

  moveToLineEnd: () => {
    const { cursor, lines } = get();
    const col = lines[cursor.row]!.length;
    set({ cursor: { row: cursor.row, col }, goalCol: col });
  },

  moveWordLeft: () => {
    const { cursor, lines } = get();
    const line = lines[cursor.row]!;
    let col = cursor.col;
    // Skip spaces backward
    while (col > 0 && line[col - 1] === ' ') col--;
    // Skip non-spaces backward
    while (col > 0 && line[col - 1] !== ' ') col--;
    set({ cursor: { row: cursor.row, col }, goalCol: col });
  },

  moveWordRight: () => {
    const { cursor, lines } = get();
    const line = lines[cursor.row]!;
    let col = cursor.col;
    // Skip spaces forward
    while (col < line.length && line[col] === ' ') col++;
    // Skip non-spaces forward
    while (col < line.length && line[col] !== ' ') col++;
    set({ cursor: { row: cursor.row, col }, goalCol: col });
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

  undo: () => {
    const { undoStack, lines, cursor, redoStack, initialContent } = get();
    if (undoStack.length === 0) return;
    const newRedo = [
      ...redoStack,
      { lines: [...lines], cursor: { ...cursor } },
    ];
    const entry = undoStack[undoStack.length - 1]!;
    const newUndo = undoStack.slice(0, -1);
    const restoredContent = entry.lines.join('\n');
    set({
      lines: entry.lines,
      cursor: entry.cursor,
      undoStack: newUndo,
      redoStack: newRedo,
      dirty: restoredContent !== initialContent,
    });
  },

  redo: () => {
    const { redoStack, lines, cursor, undoStack, initialContent } = get();
    if (redoStack.length === 0) return;
    const newUndo = [
      ...undoStack,
      { lines: [...lines], cursor: { ...cursor } },
    ];
    const entry = redoStack[redoStack.length - 1]!;
    const newRedo = redoStack.slice(0, -1);
    const restoredContent = entry.lines.join('\n');
    set({
      lines: entry.lines,
      cursor: entry.cursor,
      undoStack: newUndo,
      redoStack: newRedo,
      dirty: restoredContent !== initialContent,
    });
  },
}));

export function useEditorStore<T>(selector: (state: EditorState) => T): T {
  return useStore(editorStore, selector);
}
