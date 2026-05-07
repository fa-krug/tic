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

export interface VisibleLine {
  lineIndex: number;
  text: string;
  /** Character offset into the logical line where this visual sub-line starts */
  sliceStart: number;
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
  uploadStatus: string | null;
  initialContent: string;
  onSave: ((content: string) => void) | null;
  returnScreen: string | null;

  // Lifecycle
  init: (
    content: string,
    options?: { onSave?: (content: string) => void; returnScreen?: string },
  ) => void;
  destroy: () => void;
  getContent: () => string;

  // Viewport scrolling
  updateScroll: (viewportHeight: number, terminalWidth: number) => void;
  getVisibleLines: (
    viewportHeight: number,
    terminalWidth: number,
  ) => VisibleLine[];

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

  // Kill/Yank
  killLine: () => void;
  deleteWordBack: () => void;
  yank: () => void;
  insertTab: () => void;
  outdentTab: () => void;

  // Image paste
  insertText: (text: string) => void;

  // Page navigation
  pageUp: (viewportHeight: number) => void;
  pageDown: (viewportHeight: number) => void;

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
  uploadStatus: null as string | null,
  initialContent: '',
  onSave: null as ((content: string) => void) | null,
  returnScreen: null as string | null,
};

export function visualHeight(line: string, width: number): number {
  if (width <= 0) return 1;
  if (line.length === 0) return 1;
  return Math.ceil(line.length / width);
}

/** Compute the scroll offset needed to keep the cursor visible. */
export function computeScrollOffset(
  lines: string[],
  cursor: Cursor,
  currentOffset: number,
  viewportHeight: number,
  width: number,
): number {
  let visualRow = 0;
  for (let i = 0; i < cursor.row; i++) {
    visualRow += visualHeight(lines[i]!, width);
  }
  if (width > 0 && lines[cursor.row]!.length > 0) {
    visualRow += Math.floor(cursor.col / width);
  }

  let offset = currentOffset;
  if (visualRow < offset) {
    offset = visualRow;
  } else if (visualRow >= offset + viewportHeight) {
    offset = visualRow - viewportHeight + 1;
  }
  return offset;
}

/** Compute which lines/sub-lines are visible in the viewport (pure function). */
export function computeVisibleLines(
  lines: string[],
  scrollOffset: number,
  viewportHeight: number,
  width: number,
): VisibleLine[] {
  const result: VisibleLine[] = [];
  let visualRow = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const h = visualHeight(line, width);

    for (let subLine = 0; subLine < h; subLine++) {
      if (
        visualRow >= scrollOffset &&
        visualRow < scrollOffset + viewportHeight
      ) {
        const sliceStart = subLine * width;
        const sliceEnd = Math.min(sliceStart + width, line.length);
        result.push({
          lineIndex: i,
          text: line.slice(sliceStart, sliceEnd),
          sliceStart,
        });
      }
      visualRow++;
      if (result.length >= viewportHeight) break;
    }
    if (result.length >= viewportHeight) break;
  }

  return result;
}

// Regex for list markers: captures indent, marker, and content after marker
// Supports: "- ", "* ", "+ ", "1. ", "- [ ] ", "- [x] ", "* [ ] ", "* [x] "
const LIST_RE = /^(\s*)([-*+] \[[xX ]\] |[-*+] |\d+\. )(.*)$/;

interface ListMatch {
  indent: string;
  marker: string;
  content: string;
}

function parseListMarker(line: string): ListMatch | null {
  const m = LIST_RE.exec(line);
  if (!m) return null;
  return { indent: m[1]!, marker: m[2]!, content: m[3]! };
}

function nextMarker(marker: string): string {
  // Checkbox markers → always unchecked
  if (/^[-*+] \[[xX ]\] $/.test(marker)) {
    return marker[0] + ' [ ] ';
  }
  // Numbered list → increment
  const numMatch = /^(\d+)\. $/.exec(marker);
  if (numMatch) {
    return parseInt(numMatch[1]!, 10) + 1 + '. ';
  }
  // Unordered marker unchanged
  return marker;
}

export const editorStore = createStore<EditorState>((set, get) => ({
  ...initialState,

  init: (
    content: string,
    options?: { onSave?: (content: string) => void; returnScreen?: string },
  ) => {
    const lines = content ? content.split('\n') : [''];
    set({
      ...initialState,
      lines,
      cursor: { row: 0, col: 0 },
      goalCol: 0,
      undoStack: [],
      redoStack: [],
      initialContent: content,
      onSave: options?.onSave ?? null,
      returnScreen: options?.returnScreen ?? null,
    });
  },

  destroy: () => {
    set({ ...initialState });
  },

  getContent: () => get().lines.join('\n'),

  updateScroll: (viewportHeight: number, terminalWidth: number) => {
    const { lines, cursor, scrollOffset } = get();
    const newOffset = computeScrollOffset(
      lines,
      cursor,
      scrollOffset,
      viewportHeight,
      terminalWidth,
    );
    if (newOffset !== scrollOffset) {
      set({ scrollOffset: newOffset });
    }
  },

  getVisibleLines: (
    viewportHeight: number,
    terminalWidth: number,
  ): VisibleLine[] => {
    const { lines, scrollOffset } = get();
    return computeVisibleLines(
      lines,
      scrollOffset,
      viewportHeight,
      terminalWidth,
    );
  },

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
    } else {
      set({ cursor: { row: 0, col: 0 }, goalCol: 0 });
    }
  },

  moveDown: () => {
    const { cursor, lines, goalCol } = get();
    if (cursor.row < lines.length - 1) {
      const newRow = cursor.row + 1;
      const col = Math.min(goalCol, lines[newRow]!.length);
      set({ cursor: { row: newRow, col } });
    } else {
      const col = lines[cursor.row]!.length;
      set({ cursor: { row: cursor.row, col }, goalCol: col });
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
      cursor: { row: cursor.row, col: cursor.col + char.length },
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

    // List continuation: only when cursor is at end of line
    if (cursor.col === line.length) {
      const listMatch = parseListMarker(line);
      if (listMatch) {
        const { indent, marker, content } = listMatch;
        // Empty list item (marker only, no content) — clear the marker in place
        if (content === '') {
          const newLines = [...lines];
          newLines[cursor.row] = '';
          set({
            lines: newLines,
            cursor: { row: cursor.row, col: 0 },
            undoStack: newUndo,
            redoStack: [],
            dirty: true,
          });
          return;
        }
        // Continue with same marker
        const newMarker = nextMarker(marker);
        const prefix = indent + newMarker;
        const newLines = [...lines];
        newLines.splice(cursor.row, 1, before, prefix + after);
        set({
          lines: newLines,
          cursor: { row: cursor.row + 1, col: prefix.length },
          undoStack: newUndo,
          redoStack: [],
          dirty: true,
        });
        return;
      }
    }

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

  killLine: () => {
    const { lines, cursor, undoStack } = get();
    const killed = lines[cursor.row]!;
    const newUndo = [
      ...undoStack.slice(-(MAX_UNDO - 1)),
      { lines: [...lines], cursor: { ...cursor } },
    ];
    const newLines = [...lines];
    if (lines.length === 1) {
      // Single line: clear it but keep the empty line
      newLines[0] = '';
      set({
        lines: newLines,
        cursor: { row: 0, col: 0 },
        undoStack: newUndo,
        redoStack: [],
        killBuffer: killed,
        dirty: true,
      });
    } else {
      // Multiple lines: remove the line entirely
      newLines.splice(cursor.row, 1);
      const newRow = Math.min(cursor.row, newLines.length - 1);
      const newCol = Math.min(cursor.col, newLines[newRow]!.length);
      set({
        lines: newLines,
        cursor: { row: newRow, col: newCol },
        undoStack: newUndo,
        redoStack: [],
        killBuffer: killed,
        dirty: true,
      });
    }
  },

  deleteWordBack: () => {
    const { lines, cursor, undoStack } = get();
    const line = lines[cursor.row]!;
    let col = cursor.col;
    // Skip spaces backward
    while (col > 0 && line[col - 1] === ' ') col--;
    // Skip non-spaces backward
    while (col > 0 && line[col - 1] !== ' ') col--;
    if (col === cursor.col) return;
    const newUndo = [
      ...undoStack.slice(-(MAX_UNDO - 1)),
      { lines: [...lines], cursor: { ...cursor } },
    ];
    const newLines = [...lines];
    newLines[cursor.row] = line.slice(0, col) + line.slice(cursor.col);
    set({
      lines: newLines,
      cursor: { row: cursor.row, col },
      undoStack: newUndo,
      redoStack: [],
      dirty: true,
    });
  },

  yank: () => {
    const { lines, cursor, undoStack, killBuffer } = get();
    if (!killBuffer) return;
    const newUndo = [
      ...undoStack.slice(-(MAX_UNDO - 1)),
      { lines: [...lines], cursor: { ...cursor } },
    ];
    const line = lines[cursor.row]!;

    if (killBuffer.includes('\n')) {
      // Multi-line yank: split at newlines
      const parts = killBuffer.split('\n');
      const before = line.slice(0, cursor.col);
      const after = line.slice(cursor.col);
      const newLines = [...lines];
      // First part appends to current line before cursor
      newLines[cursor.row] = before + parts[0]!;
      // Middle parts inserted as new lines
      for (let i = 1; i < parts.length; i++) {
        newLines.splice(cursor.row + i, 0, parts[i]!);
      }
      // Last part gets the remainder of the original line
      const lastPartIdx = cursor.row + parts.length - 1;
      newLines[lastPartIdx] = newLines[lastPartIdx]! + after;
      const newRow = cursor.row + parts.length - 1;
      const newCol = parts[parts.length - 1]!.length;
      set({
        lines: newLines,
        cursor: { row: newRow, col: newCol },
        undoStack: newUndo,
        redoStack: [],
        dirty: true,
      });
    } else {
      const newLine =
        line.slice(0, cursor.col) + killBuffer + line.slice(cursor.col);
      const newLines = [...lines];
      newLines[cursor.row] = newLine;
      set({
        lines: newLines,
        cursor: { row: cursor.row, col: cursor.col + killBuffer.length },
        undoStack: newUndo,
        redoStack: [],
        dirty: true,
      });
    }
  },

  insertTab: () => {
    const { lines, cursor, undoStack } = get();
    const newUndo = [
      ...undoStack.slice(-(MAX_UNDO - 1)),
      { lines: [...lines], cursor: { ...cursor } },
    ];
    const line = lines[cursor.row]!;
    const newLines = [...lines];
    // On a list line, indent the whole line so list nesting works regardless
    // of cursor position within the line.
    if (LIST_RE.test(line)) {
      newLines[cursor.row] = '  ' + line;
      set({
        lines: newLines,
        cursor: { row: cursor.row, col: cursor.col + 2 },
        undoStack: newUndo,
        redoStack: [],
        dirty: true,
      });
      return;
    }
    const newLine = line.slice(0, cursor.col) + '  ' + line.slice(cursor.col);
    newLines[cursor.row] = newLine;
    set({
      lines: newLines,
      cursor: { row: cursor.row, col: cursor.col + 2 },
      undoStack: newUndo,
      redoStack: [],
      dirty: true,
    });
  },

  outdentTab: () => {
    const { lines, cursor, undoStack } = get();
    const line = lines[cursor.row]!;
    if (!LIST_RE.test(line) || !line.startsWith('  ')) return;
    const newUndo = [
      ...undoStack.slice(-(MAX_UNDO - 1)),
      { lines: [...lines], cursor: { ...cursor } },
    ];
    const newLines = [...lines];
    newLines[cursor.row] = line.slice(2);
    const newCol = Math.max(0, cursor.col - 2);
    set({
      lines: newLines,
      cursor: { row: cursor.row, col: newCol },
      undoStack: newUndo,
      redoStack: [],
      dirty: true,
    });
  },

  insertText: (text: string) => {
    const { lines, cursor, undoStack } = get();
    const newUndo = [
      ...undoStack.slice(-(MAX_UNDO - 1)),
      { lines: [...lines], cursor: { ...cursor } },
    ];
    const line = lines[cursor.row]!;
    const newLine = line.slice(0, cursor.col) + text + line.slice(cursor.col);
    const newLines = [...lines];
    newLines[cursor.row] = newLine;
    set({
      lines: newLines,
      cursor: { row: cursor.row, col: cursor.col + text.length },
      undoStack: newUndo,
      redoStack: [],
      dirty: true,
    });
  },

  pageUp: (viewportHeight: number) => {
    const { cursor, lines, goalCol } = get();
    const jump = Math.max(1, Math.floor(viewportHeight / 2));
    const newRow = Math.max(0, cursor.row - jump);
    const col = Math.min(goalCol, lines[newRow]!.length);
    set({ cursor: { row: newRow, col } });
  },

  pageDown: (viewportHeight: number) => {
    const { cursor, lines, goalCol } = get();
    const jump = Math.max(1, Math.floor(viewportHeight / 2));
    const newRow = Math.min(lines.length - 1, cursor.row + jump);
    const col = Math.min(goalCol, lines[newRow]!.length);
    set({ cursor: { row: newRow, col } });
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
