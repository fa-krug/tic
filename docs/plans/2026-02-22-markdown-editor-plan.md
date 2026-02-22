# Built-in Markdown Editor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace external `$EDITOR` with a built-in full-screen markdown editor featuring syntax highlighting, readline keybindings, and undo/redo.

**Architecture:** Three layers — `editorStore` (Zustand vanilla store for document model, cursor, undo), `markdownHighlight` (pure function for regex-based syntax highlighting), and `MarkdownEditor` (React/Ink component for rendering and input handling). No new dependencies.

**Tech Stack:** TypeScript, React 19, Ink 6, Zustand, Vitest

**Design doc:** `docs/plans/2026-02-22-markdown-editor-design.md`

---

## Task 1: Editor Store — Core Document Model

**Files:**
- Create: `src/stores/editorStore.ts`
- Create: `src/stores/editorStore.test.ts`

### Step 1: Write failing tests for init/destroy lifecycle and basic state

```typescript
// src/stores/editorStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { editorStore } from './editorStore.js';

beforeEach(() => {
  editorStore.getState().destroy();
});

describe('editorStore', () => {
  describe('init/destroy', () => {
    it('initializes with content split into lines', () => {
      editorStore.getState().init('hello\nworld');
      const s = editorStore.getState();
      expect(s.lines).toEqual(['hello', 'world']);
      expect(s.cursor).toEqual({ row: 0, col: 0 });
      expect(s.dirty).toBe(false);
    });

    it('initializes empty content as single empty line', () => {
      editorStore.getState().init('');
      expect(editorStore.getState().lines).toEqual(['']);
    });

    it('destroy resets to initial state', () => {
      editorStore.getState().init('hello');
      editorStore.getState().destroy();
      expect(editorStore.getState().lines).toEqual(['']);
      expect(editorStore.getState().dirty).toBe(false);
    });
  });

  describe('getContent', () => {
    it('joins lines with newline', () => {
      editorStore.getState().init('hello\nworld');
      expect(editorStore.getState().getContent()).toBe('hello\nworld');
    });
  });
});
```

### Step 2: Run tests to verify they fail

Run: `npx vitest run src/stores/editorStore.test.ts`
Expected: FAIL — module not found

### Step 3: Implement editorStore with init/destroy/getContent

```typescript
// src/stores/editorStore.ts
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
```

### Step 4: Run tests to verify they pass

Run: `npx vitest run src/stores/editorStore.test.ts`
Expected: PASS

### Step 5: Commit

```
feat: add editorStore with init/destroy lifecycle
```

---

## Task 2: Editor Store — Character Insertion and Deletion

**Files:**
- Modify: `src/stores/editorStore.ts`
- Modify: `src/stores/editorStore.test.ts`

### Step 1: Write failing tests for insertChar, insertNewline, deleteBefore, deleteAt

```typescript
describe('insertChar', () => {
  it('inserts character at cursor and advances col', () => {
    editorStore.getState().init('');
    editorStore.getState().insertChar('a');
    const s = editorStore.getState();
    expect(s.lines).toEqual(['a']);
    expect(s.cursor).toEqual({ row: 0, col: 1 });
    expect(s.dirty).toBe(true);
  });

  it('inserts in middle of line', () => {
    editorStore.getState().init('ac');
    editorStore.getState().moveCursorTo(0, 1);
    editorStore.getState().insertChar('b');
    expect(editorStore.getState().lines).toEqual(['abc']);
    expect(editorStore.getState().cursor.col).toBe(2);
  });
});

describe('insertNewline', () => {
  it('splits line at cursor position', () => {
    editorStore.getState().init('hello world');
    editorStore.getState().moveCursorTo(0, 5);
    editorStore.getState().insertNewline();
    const s = editorStore.getState();
    expect(s.lines).toEqual(['hello', ' world']);
    expect(s.cursor).toEqual({ row: 1, col: 0 });
  });
});

describe('deleteBefore (backspace)', () => {
  it('deletes character before cursor', () => {
    editorStore.getState().init('abc');
    editorStore.getState().moveCursorTo(0, 2);
    editorStore.getState().deleteBefore();
    expect(editorStore.getState().lines).toEqual(['ac']);
    expect(editorStore.getState().cursor.col).toBe(1);
  });

  it('joins with previous line at col 0', () => {
    editorStore.getState().init('hello\nworld');
    editorStore.getState().moveCursorTo(1, 0);
    editorStore.getState().deleteBefore();
    expect(editorStore.getState().lines).toEqual(['helloworld']);
    expect(editorStore.getState().cursor).toEqual({ row: 0, col: 5 });
  });

  it('does nothing at start of document', () => {
    editorStore.getState().init('hello');
    editorStore.getState().moveCursorTo(0, 0);
    editorStore.getState().deleteBefore();
    expect(editorStore.getState().lines).toEqual(['hello']);
  });
});

describe('deleteAt (delete key)', () => {
  it('deletes character at cursor', () => {
    editorStore.getState().init('abc');
    editorStore.getState().moveCursorTo(0, 1);
    editorStore.getState().deleteAt();
    expect(editorStore.getState().lines).toEqual(['ac']);
    expect(editorStore.getState().cursor.col).toBe(1);
  });

  it('joins with next line at end of line', () => {
    editorStore.getState().init('hello\nworld');
    editorStore.getState().moveCursorTo(0, 5);
    editorStore.getState().deleteAt();
    expect(editorStore.getState().lines).toEqual(['helloworld']);
  });

  it('does nothing at end of document', () => {
    editorStore.getState().init('hello');
    editorStore.getState().moveCursorTo(0, 5);
    editorStore.getState().deleteAt();
    expect(editorStore.getState().lines).toEqual(['hello']);
  });
});
```

### Step 2: Run tests to verify they fail

Run: `npx vitest run src/stores/editorStore.test.ts`
Expected: FAIL — methods not found

### Step 3: Implement the editing actions

Add a private helper to push undo snapshots before mutations. Add `moveCursorTo`, `insertChar`, `insertNewline`, `deleteBefore`, `deleteAt` to the store. Each editing action:
1. Pushes current `{ lines, cursor }` to `undoStack`
2. Clears `redoStack`
3. Performs the mutation
4. Sets `dirty: true`

Add `moveCursorTo(row, col)` as a utility (doesn't push undo — it's a navigation action not an edit).

### Step 4: Run tests to verify they pass

Run: `npx vitest run src/stores/editorStore.test.ts`
Expected: PASS

### Step 5: Commit

```
feat: add character insertion and deletion to editorStore
```

---

## Task 3: Editor Store — Cursor Movement

**Files:**
- Modify: `src/stores/editorStore.ts`
- Modify: `src/stores/editorStore.test.ts`

### Step 1: Write failing tests for cursor movement

```typescript
describe('cursor movement', () => {
  it('moves left', () => {
    editorStore.getState().init('abc');
    editorStore.getState().moveCursorTo(0, 2);
    editorStore.getState().moveLeft();
    expect(editorStore.getState().cursor.col).toBe(1);
  });

  it('moves left wraps to previous line end', () => {
    editorStore.getState().init('ab\ncd');
    editorStore.getState().moveCursorTo(1, 0);
    editorStore.getState().moveLeft();
    expect(editorStore.getState().cursor).toEqual({ row: 0, col: 2 });
  });

  it('moves left does nothing at document start', () => {
    editorStore.getState().init('abc');
    editorStore.getState().moveCursorTo(0, 0);
    editorStore.getState().moveLeft();
    expect(editorStore.getState().cursor).toEqual({ row: 0, col: 0 });
  });

  it('moves right', () => {
    editorStore.getState().init('abc');
    editorStore.getState().moveCursorTo(0, 1);
    editorStore.getState().moveRight();
    expect(editorStore.getState().cursor.col).toBe(2);
  });

  it('moves right wraps to next line start', () => {
    editorStore.getState().init('ab\ncd');
    editorStore.getState().moveCursorTo(0, 2);
    editorStore.getState().moveRight();
    expect(editorStore.getState().cursor).toEqual({ row: 1, col: 0 });
  });

  it('moves up preserving goalCol', () => {
    editorStore.getState().init('long line\nhi\nanother long');
    editorStore.getState().moveCursorTo(0, 8);
    editorStore.getState().moveDown(); // row 1, col clamped to 2
    expect(editorStore.getState().cursor).toEqual({ row: 1, col: 2 });
    editorStore.getState().moveDown(); // row 2, col restored to 8
    expect(editorStore.getState().cursor).toEqual({ row: 2, col: 8 });
  });

  it('moveUp does nothing at first line', () => {
    editorStore.getState().init('abc');
    editorStore.getState().moveUp();
    expect(editorStore.getState().cursor.row).toBe(0);
  });

  it('moveDown does nothing at last line', () => {
    editorStore.getState().init('abc');
    editorStore.getState().moveDown();
    expect(editorStore.getState().cursor.row).toBe(0);
  });

  it('moveToLineStart sets col to 0', () => {
    editorStore.getState().init('hello');
    editorStore.getState().moveCursorTo(0, 3);
    editorStore.getState().moveToLineStart();
    expect(editorStore.getState().cursor.col).toBe(0);
  });

  it('moveToLineEnd sets col to line length', () => {
    editorStore.getState().init('hello');
    editorStore.getState().moveCursorTo(0, 0);
    editorStore.getState().moveToLineEnd();
    expect(editorStore.getState().cursor.col).toBe(5);
  });

  it('moveWordLeft jumps to previous word boundary', () => {
    editorStore.getState().init('hello world foo');
    editorStore.getState().moveCursorTo(0, 15);
    editorStore.getState().moveWordLeft();
    expect(editorStore.getState().cursor.col).toBe(12);
    editorStore.getState().moveWordLeft();
    expect(editorStore.getState().cursor.col).toBe(6);
    editorStore.getState().moveWordLeft();
    expect(editorStore.getState().cursor.col).toBe(0);
  });

  it('moveWordRight jumps to next word boundary', () => {
    editorStore.getState().init('hello world foo');
    editorStore.getState().moveCursorTo(0, 0);
    editorStore.getState().moveWordRight();
    expect(editorStore.getState().cursor.col).toBe(5);
    editorStore.getState().moveWordRight();
    expect(editorStore.getState().cursor.col).toBe(11);
  });
});
```

### Step 2: Run tests to verify they fail

Run: `npx vitest run src/stores/editorStore.test.ts`
Expected: FAIL

### Step 3: Implement cursor movement actions

Add `moveLeft`, `moveRight`, `moveUp`, `moveDown`, `moveToLineStart`, `moveToLineEnd`, `moveWordLeft`, `moveWordRight`. Key detail: `moveUp`/`moveDown` use `goalCol` — horizontal movement resets `goalCol` to current col, vertical movement clamps col but preserves `goalCol`.

### Step 4: Run tests to verify they pass

Run: `npx vitest run src/stores/editorStore.test.ts`
Expected: PASS

### Step 5: Commit

```
feat: add cursor movement to editorStore
```

---

## Task 4: Editor Store — Undo/Redo

**Files:**
- Modify: `src/stores/editorStore.ts`
- Modify: `src/stores/editorStore.test.ts`

### Step 1: Write failing tests for undo/redo

```typescript
describe('undo/redo', () => {
  it('undo reverses last edit', () => {
    editorStore.getState().init('hello');
    editorStore.getState().moveCursorTo(0, 5);
    editorStore.getState().insertChar('!');
    expect(editorStore.getState().lines).toEqual(['hello!']);
    editorStore.getState().undo();
    expect(editorStore.getState().lines).toEqual(['hello']);
    expect(editorStore.getState().cursor).toEqual({ row: 0, col: 5 });
  });

  it('redo restores undone edit', () => {
    editorStore.getState().init('hello');
    editorStore.getState().moveCursorTo(0, 5);
    editorStore.getState().insertChar('!');
    editorStore.getState().undo();
    editorStore.getState().redo();
    expect(editorStore.getState().lines).toEqual(['hello!']);
  });

  it('new edit clears redo stack', () => {
    editorStore.getState().init('hello');
    editorStore.getState().moveCursorTo(0, 5);
    editorStore.getState().insertChar('!');
    editorStore.getState().undo();
    editorStore.getState().insertChar('?');
    editorStore.getState().redo(); // should do nothing
    expect(editorStore.getState().lines).toEqual(['hello?']);
  });

  it('undo does nothing when stack is empty', () => {
    editorStore.getState().init('hello');
    editorStore.getState().undo();
    expect(editorStore.getState().lines).toEqual(['hello']);
  });

  it('undo stack is capped at 50', () => {
    editorStore.getState().init('');
    for (let i = 0; i < 60; i++) {
      editorStore.getState().insertChar('x');
    }
    expect(editorStore.getState().undoStack.length).toBeLessThanOrEqual(50);
  });

  it('undo restores dirty to false when back to initial', () => {
    editorStore.getState().init('hello');
    editorStore.getState().moveCursorTo(0, 5);
    editorStore.getState().insertChar('!');
    expect(editorStore.getState().dirty).toBe(true);
    editorStore.getState().undo();
    expect(editorStore.getState().dirty).toBe(false);
  });
});
```

### Step 2: Run tests to verify they fail

Run: `npx vitest run src/stores/editorStore.test.ts`
Expected: FAIL — `undo`/`redo` not defined

### Step 3: Implement undo/redo

Add `undo` and `redo` actions. `undo` pops from `undoStack`, pushes current to `redoStack`, restores lines+cursor. `redo` does the reverse. `dirty` is recalculated by comparing current lines to the initial content (stored during `init`). Store `initialContent` as a private field set during `init`.

### Step 4: Run tests to verify they pass

Run: `npx vitest run src/stores/editorStore.test.ts`
Expected: PASS

### Step 5: Commit

```
feat: add undo/redo to editorStore
```

---

## Task 5: Editor Store — Readline Kill/Yank Actions

**Files:**
- Modify: `src/stores/editorStore.ts`
- Modify: `src/stores/editorStore.test.ts`

### Step 1: Write failing tests for kill/yank

```typescript
describe('kill/yank', () => {
  it('killToEnd removes from cursor to end of line', () => {
    editorStore.getState().init('hello world');
    editorStore.getState().moveCursorTo(0, 5);
    editorStore.getState().killToEnd();
    expect(editorStore.getState().lines).toEqual(['hello']);
    expect(editorStore.getState().killBuffer).toBe(' world');
  });

  it('killToEnd at end of line joins with next', () => {
    editorStore.getState().init('hello\nworld');
    editorStore.getState().moveCursorTo(0, 5);
    editorStore.getState().killToEnd();
    expect(editorStore.getState().lines).toEqual(['helloworld']);
  });

  it('killToStart removes from start to cursor', () => {
    editorStore.getState().init('hello world');
    editorStore.getState().moveCursorTo(0, 5);
    editorStore.getState().killToStart();
    expect(editorStore.getState().lines).toEqual([' world']);
    expect(editorStore.getState().cursor.col).toBe(0);
  });

  it('deleteWordBack removes previous word', () => {
    editorStore.getState().init('hello world');
    editorStore.getState().moveCursorTo(0, 11);
    editorStore.getState().deleteWordBack();
    expect(editorStore.getState().lines).toEqual(['hello ']);
    expect(editorStore.getState().cursor.col).toBe(6);
  });

  it('yank inserts kill buffer at cursor', () => {
    editorStore.getState().init('hello world');
    editorStore.getState().moveCursorTo(0, 5);
    editorStore.getState().killToEnd();
    editorStore.getState().moveCursorTo(0, 0);
    editorStore.getState().yank();
    expect(editorStore.getState().lines).toEqual([' worldhello']);
  });

  it('insertTab inserts two spaces', () => {
    editorStore.getState().init('hello');
    editorStore.getState().moveCursorTo(0, 0);
    editorStore.getState().insertTab();
    expect(editorStore.getState().lines).toEqual(['  hello']);
    expect(editorStore.getState().cursor.col).toBe(2);
  });
});
```

### Step 2: Run tests to verify they fail

Run: `npx vitest run src/stores/editorStore.test.ts`
Expected: FAIL

### Step 3: Implement kill/yank actions

Add `killToEnd` (Ctrl+K), `killToStart` (Ctrl+U), `deleteWordBack` (Ctrl+W), `yank` (Ctrl+Y), `insertTab`. All editing actions push to undo stack. `killToEnd`/`killToStart` store the killed text in `killBuffer`. Special case for `killToEnd` when cursor is at end of line: join with next line (like readline behavior).

### Step 4: Run tests to verify they pass

Run: `npx vitest run src/stores/editorStore.test.ts`
Expected: PASS

### Step 5: Commit

```
feat: add readline kill/yank actions to editorStore
```

---

## Task 6: Editor Store — Viewport Scrolling

**Files:**
- Modify: `src/stores/editorStore.ts`
- Modify: `src/stores/editorStore.test.ts`

### Step 1: Write failing tests for viewport scrolling

```typescript
describe('viewport scrolling', () => {
  it('updateScroll keeps cursor visible', () => {
    editorStore.getState().init('a\nb\nc\nd\ne\nf');
    // viewport of 3 lines, terminal width 80 (no wrapping)
    editorStore.getState().moveCursorTo(4, 0); // row 4 "e"
    editorStore.getState().updateScroll(3, 80);
    expect(editorStore.getState().scrollOffset).toBe(2); // shows rows 2,3,4
  });

  it('scrolls up when cursor moves above viewport', () => {
    editorStore.getState().init('a\nb\nc\nd\ne');
    editorStore.getState().moveCursorTo(4, 0);
    editorStore.getState().updateScroll(3, 80);
    editorStore.getState().moveCursorTo(1, 0);
    editorStore.getState().updateScroll(3, 80);
    expect(editorStore.getState().scrollOffset).toBe(1);
  });

  it('accounts for soft-wrapped lines', () => {
    // Line of 160 chars at width 80 takes 2 visual rows
    editorStore.getState().init('x'.repeat(160) + '\nb\nc');
    editorStore.getState().moveCursorTo(2, 0); // row 2 "c"
    editorStore.getState().updateScroll(3, 80);
    // visual rows: row0 takes 2, row1 takes 1, row2 takes 1 = total 4
    // cursor at visual row 3 (0-indexed), viewport 3 → scroll to 1
    expect(editorStore.getState().scrollOffset).toBeGreaterThan(0);
  });

  it('getVisibleLines returns correct slice', () => {
    editorStore.getState().init('a\nb\nc\nd\ne');
    editorStore.getState().moveCursorTo(3, 0);
    editorStore.getState().updateScroll(3, 80);
    const visible = editorStore.getState().getVisibleLines(3, 80);
    expect(visible.length).toBeLessThanOrEqual(3);
  });
});
```

### Step 2: Run tests to verify they fail

Run: `npx vitest run src/stores/editorStore.test.ts`
Expected: FAIL

### Step 3: Implement viewport scrolling

Add `updateScroll(viewportHeight, terminalWidth)` which calculates the visual row of the cursor (accounting for soft-wrap: each line occupies `Math.max(1, Math.ceil(line.length / terminalWidth))` visual rows), then adjusts `scrollOffset` to keep cursor visible.

Add `getVisibleLines(viewportHeight, terminalWidth)` which returns the document lines that fit in the viewport starting from `scrollOffset`, accounting for wrap.

### Step 4: Run tests to verify they pass

Run: `npx vitest run src/stores/editorStore.test.ts`
Expected: PASS

### Step 5: Commit

```
feat: add viewport scrolling to editorStore
```

---

## Task 7: Markdown Syntax Highlighting

**Files:**
- Create: `src/components/markdownHighlight.ts`
- Create: `src/components/markdownHighlight.test.ts`

### Step 1: Write failing tests for each token type

```typescript
// src/components/markdownHighlight.test.ts
import { describe, it, expect } from 'vitest';
import { tokenize, type Token } from './markdownHighlight.js';

describe('tokenize', () => {
  it('returns plain text for no markdown', () => {
    const tokens = tokenize('hello world');
    expect(tokens).toEqual([{ type: 'text', text: 'hello world' }]);
  });

  it('highlights headings', () => {
    const tokens = tokenize('## Hello');
    expect(tokens[0]).toEqual({ type: 'heading-marker', text: '## ' });
    expect(tokens[1]).toEqual({ type: 'heading-text', text: 'Hello' });
  });

  it('highlights bold', () => {
    const tokens = tokenize('hello **bold** world');
    expect(tokens).toEqual([
      { type: 'text', text: 'hello ' },
      { type: 'bold', text: '**bold**' },
      { type: 'text', text: ' world' },
    ]);
  });

  it('highlights italic', () => {
    const tokens = tokenize('hello *italic* world');
    expect(tokens).toEqual([
      { type: 'text', text: 'hello ' },
      { type: 'italic', text: '*italic*' },
      { type: 'text', text: ' world' },
    ]);
  });

  it('highlights code spans', () => {
    const tokens = tokenize('use `foo()` here');
    expect(tokens).toEqual([
      { type: 'text', text: 'use ' },
      { type: 'code', text: '`foo()`' },
      { type: 'text', text: ' here' },
    ]);
  });

  it('code spans suppress inner markdown', () => {
    const tokens = tokenize('`**not bold**`');
    expect(tokens).toEqual([{ type: 'code', text: '`**not bold**`' }]);
  });

  it('highlights links', () => {
    const tokens = tokenize('[click](http://x.com)');
    expect(tokens).toEqual([{ type: 'link', text: '[click](http://x.com)' }]);
  });

  it('highlights image links', () => {
    const tokens = tokenize('![alt](img.png)');
    expect(tokens).toEqual([{ type: 'image', text: '![alt](img.png)' }]);
  });

  it('highlights blockquotes', () => {
    const tokens = tokenize('> quoted text');
    expect(tokens[0]).toEqual({ type: 'blockquote-marker', text: '> ' });
    expect(tokens[1]).toEqual({ type: 'blockquote-text', text: 'quoted text' });
  });

  it('highlights list bullets', () => {
    const tokens = tokenize('- list item');
    expect(tokens[0]).toEqual({ type: 'list-marker', text: '- ' });
    expect(tokens[1]).toEqual({ type: 'text', text: 'list item' });
  });

  it('highlights horizontal rules', () => {
    const tokens = tokenize('---');
    expect(tokens).toEqual([{ type: 'hr', text: '---' }]);
  });

  it('handles multiple tokens in one line', () => {
    const tokens = tokenize('hello **bold** and `code`');
    expect(tokens.length).toBe(4);
    expect(tokens[1].type).toBe('bold');
    expect(tokens[3].type).toBe('code');
  });
});
```

### Step 2: Run tests to verify they fail

Run: `npx vitest run src/components/markdownHighlight.test.ts`
Expected: FAIL — module not found

### Step 3: Implement tokenizer

```typescript
// src/components/markdownHighlight.ts
// Exports:
// - Token type: { type: string, text: string }
// - tokenize(line: string): Token[] — pure function, regex left-to-right scan
// - highlightLine(line: string): React.ReactNode — maps tokens to <Text> elements
```

The `tokenize` function:
1. Check full-line patterns first (heading, blockquote, list bullet, HR)
2. For inline content, scan left-to-right finding earliest match among: code span, bold, italic, image link, link
3. Emit text token for any gap before the match, emit the typed token, advance position
4. Repeat until end of string

The `highlightLine` function maps token types to Ink `<Text>` elements:
- `heading-marker` → `<Text bold dimColor>`
- `heading-text` → `<Text bold color="cyan">`
- `bold` → `<Text bold>`
- `italic` → `<Text dimColor>`
- `code` → `<Text color="yellow">`
- `link` → `<Text color="blue" underline>`
- `image` → `<Text color="green">`
- `blockquote-marker` / `blockquote-text` → `<Text dimColor>`
- `list-marker` → `<Text color="cyan">`
- `hr` → `<Text dimColor>`
- `text` → `<Text>`

Use the theme's accent color from `themeStore` where appropriate instead of hardcoded colors.

### Step 4: Run tests to verify they pass

Run: `npx vitest run src/components/markdownHighlight.test.ts`
Expected: PASS

### Step 5: Commit

```
feat: add markdown syntax highlighting tokenizer
```

---

## Task 8: Navigation Store — Add Editor Screen

**Files:**
- Modify: `src/stores/navigationStore.ts`
- Modify: `src/commands.ts` (add editor commands to help screen)

### Step 1: Add `editor` to the Screen type

In `src/stores/navigationStore.ts`, add `'editor'` to the `Screen` union type:

```typescript
export type Screen =
  | 'list'
  | 'form'
  | 'editor'   // ← add
  | 'iteration-picker'
  | 'pr-list'
  | 'branch-list'
  | 'settings'
  | 'status'
  | 'help';
```

### Step 2: Add editor commands to commands.ts

Add help entries for the editor screen so they show in HelpScreen:

```typescript
// Editor commands — for help screen only (keybindings handled in MarkdownEditor)
{
  id: 'editor-save',
  label: 'Save and return',
  category: 'Actions',
  shortcut: 'Ctrl+S',
  keys: [],
  screen: 'editor',
  helpGroup: 'Editor',
},
{
  id: 'editor-cancel',
  label: 'Cancel and return',
  category: 'Navigation',
  shortcut: 'Esc',
  keys: [],
  screen: 'editor',
  helpGroup: 'Editor',
},
{
  id: 'editor-undo',
  label: 'Undo',
  category: 'Actions',
  shortcut: 'Ctrl+Z',
  keys: [],
  screen: 'editor',
  helpGroup: 'Editor',
},
{
  id: 'editor-redo',
  label: 'Redo',
  category: 'Actions',
  shortcut: 'Ctrl+Shift+Z',
  keys: [],
  screen: 'editor',
  helpGroup: 'Editor',
},
```

### Step 3: Run build to verify no type errors

Run: `npx tsc --noEmit`
Expected: PASS

### Step 4: Commit

```
feat: add editor screen type and help commands
```

---

## Task 9: MarkdownEditor Component

**Files:**
- Create: `src/components/MarkdownEditor.tsx`
- Modify: `src/app.tsx`

### Step 1: Create the MarkdownEditor component

```tsx
// src/components/MarkdownEditor.tsx
// Full-screen component with three sections:
// 1. Status bar (top) — item context + cursor position
// 2. Editor area (middle) — rendered lines with syntax highlighting
// 3. Help bar (bottom) — key shortcuts / discard prompt

// Uses:
// - useEditorStore() for document state
// - useTerminalSize() for viewport dimensions
// - useInput() for keybinding dispatch
// - highlightLine() for rendering each visible line
// - formStackStore for item context (id, title)
// - navigationStore for save/cancel navigation

// Key implementation details:
// - useInput handler maps key events to editorStore actions
// - After every action that moves cursor, call updateScroll(viewportHeight, width)
// - Render loop: get visible lines via getVisibleLines(), map each through highlightLine()
// - Cursor rendered by splitting the current line at cursor col and inserting an inverse-video char
// - Status bar reads cursor position from editorStore
// - Help bar shows "Ctrl+S Save  Esc Cancel  Ctrl+Z Undo  Ctrl+Y Yank"
// - When showDiscardPrompt is true, help bar changes to "Discard changes? (d) discard  (esc) back"
```

The component structure:

```tsx
export function MarkdownEditor() {
  const lines = useEditorStore((s) => s.lines);
  const cursor = useEditorStore((s) => s.cursor);
  const dirty = useEditorStore((s) => s.dirty);
  const showDiscardPrompt = useEditorStore((s) => s.showDiscardPrompt);
  const { height, width } = useTerminalSize();
  const viewportHeight = height - 2; // status bar + help bar

  const draft = useFormStackStore((s) => s.currentDraft());

  // Scroll after every render
  useEffect(() => {
    editorStore.getState().updateScroll(viewportHeight, width);
  }, [cursor.row, cursor.col, lines.length, viewportHeight, width]);

  useInput((input, key) => {
    const s = editorStore.getState();
    if (showDiscardPrompt) {
      if (input === 'd') { s.destroy(); navigationStore.getState().navigate('form'); }
      if (key.escape) { s.setShowDiscardPrompt(false); }
      return;
    }
    // Ctrl+S → save
    if (input === 's' && key.ctrl) {
      formStackStore.getState().updateFields({ description: s.getContent() });
      s.destroy();
      navigationStore.getState().navigate('form');
      return;
    }
    // Esc → cancel (with prompt if dirty)
    if (key.escape) {
      if (s.dirty) { s.setShowDiscardPrompt(true); }
      else { s.destroy(); navigationStore.getState().navigate('form'); }
      return;
    }
    // Map all other keys to store actions...
    // Ctrl+Z → undo, Ctrl+Shift+Z → redo
    // Ctrl+A → moveToLineStart, Ctrl+E → moveToLineEnd
    // Ctrl+K → killToEnd, Ctrl+U → killToStart, Ctrl+W → deleteWordBack, Ctrl+Y → yank
    // Arrow keys → moveUp/Down/Left/Right
    // Ctrl+Left/Right → moveWordLeft/Right
    // Backspace → deleteBefore, Delete → deleteAt
    // Enter → insertNewline, Tab → insertTab
    // Printable → insertChar(input)
  });

  // Render
  const visibleLines = editorStore.getState().getVisibleLines(viewportHeight, width);
  return (
    <Box flexDirection="column" height={height}>
      {/* Status bar */}
      <Box>
        <Text bold>Editing: #{draft?.itemId} {draft?.itemTitle}</Text>
        <Text> Ln {cursor.row + 1}, Col {cursor.col + 1}{dirty ? ' [modified]' : ''}</Text>
      </Box>
      {/* Editor area */}
      <Box flexDirection="column" height={viewportHeight}>
        {visibleLines.map((line, i) => (
          <Box key={i}>
            {/* Render line with cursor if it's the cursor line */}
            {renderLineWithCursor(line, i, cursor, scrollOffset, width)}
          </Box>
        ))}
      </Box>
      {/* Help bar */}
      <Box>
        {showDiscardPrompt
          ? <Text>Discard changes? <Text bold>(d)</Text> discard  <Text bold>(esc)</Text> back</Text>
          : <Text dimColor>Ctrl+S save  Esc cancel  Ctrl+Z undo  Ctrl+K cut  Ctrl+Y yank</Text>
        }
      </Box>
    </Box>
  );
}
```

### Step 2: Add lazy-loaded route in app.tsx

In `src/app.tsx`, add the lazy import and screen conditional:

```tsx
const MarkdownEditor = lazy(() =>
  import('./components/MarkdownEditor.js').then((m) => ({
    default: m.MarkdownEditor,
  })),
);

// In the JSX, inside the Suspense block:
{screen === 'editor' && <MarkdownEditor />}
```

### Step 3: Run build to verify

Run: `npx tsc --noEmit`
Expected: PASS

### Step 4: Commit

```
feat: add MarkdownEditor component with screen routing
```

---

## Task 10: WorkItemForm — Wire Description to Editor

**Files:**
- Modify: `src/components/WorkItemForm.tsx`

### Step 1: Replace external editor with navigation to editor screen

In `WorkItemForm.tsx`, find the description field's Enter handler (around line 879):

Replace:
```typescript
} else if (currentField === 'description') {
  // Open external editor for description
  try {
    process.stdin.setRawMode?.(false);
    const edited = openInEditor(description);
    process.stdin.setRawMode?.(true);
    console.clear();
    setDescription(edited);
  } catch {
    process.stdin.setRawMode?.(true);
    console.clear();
    setEditing(true);
  }
}
```

With:
```typescript
} else if (currentField === 'description') {
  editorStore.getState().init(description);
  navigationStore.getState().navigate('editor');
}
```

Update the description field hint text (around line 1274):

Replace:
```tsx
<Text dimColor={mutedDim}> [enter opens $EDITOR]</Text>
```

With:
```tsx
<Text dimColor={mutedDim}> [enter to edit]</Text>
```

Add import for `editorStore` at the top of the file.

Remove the `openInEditor` import (check no other usage first).

### Step 2: Run build and tests

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS

### Step 3: Manual testing

Run: `npm start`
- Navigate to a work item, press Enter
- Focus the description field, press Enter
- Verify the editor opens full-screen with the description content
- Type some text, verify syntax highlighting
- Test Ctrl+K, Ctrl+Y, Ctrl+Z, arrow keys, Home/End
- Press Ctrl+S → verify description is saved back
- Press Esc → verify discard prompt when dirty

### Step 4: Commit

```
feat: wire WorkItemForm description field to built-in editor
```

---

## Task 11: Cleanup and Final Verification

**Files:**
- Check: `src/editor.ts` — remove `openInEditor` import from WorkItemForm if not used elsewhere

### Step 1: Check if editor.ts is used anywhere else

Run: `grep -r 'openInEditor\|from.*editor' src/ --include='*.ts' --include='*.tsx'`

If only used in WorkItemForm (now removed), the import of `openInEditor` in WorkItemForm can be deleted. Keep `src/editor.ts` itself — it may be used by `src/implement.ts` or other code.

### Step 2: Run full verification suite

Run: `npm run format:check && npm run lint && npx tsc --noEmit && npm test`
Expected: ALL PASS

### Step 3: Commit any cleanup

```
chore: remove unused openInEditor import from WorkItemForm
```

---

## Summary

| Task | What | Key Files |
|------|------|-----------|
| 1 | Store lifecycle | `editorStore.ts` |
| 2 | Insert/delete | `editorStore.ts` |
| 3 | Cursor movement | `editorStore.ts` |
| 4 | Undo/redo | `editorStore.ts` |
| 5 | Kill/yank | `editorStore.ts` |
| 6 | Viewport scrolling | `editorStore.ts` |
| 7 | Syntax highlighting | `markdownHighlight.ts` |
| 8 | Screen type + commands | `navigationStore.ts`, `commands.ts` |
| 9 | Editor component | `MarkdownEditor.tsx`, `app.tsx` |
| 10 | Wire to form | `WorkItemForm.tsx` |
| 11 | Cleanup + verification | all |
