# Built-in Markdown Editor Design

**Date:** 2026-02-22
**Status:** Approved (v2 — replaces ink-multiline-input approach)

## Summary

Replace the external `$EDITOR` workflow for description editing with a built-in full-screen markdown editor. Built from scratch using Ink primitives (`useInput`, `<Box>`, `<Text>`) with a Zustand store for editor state, regex-based syntax highlighting, readline keybindings, and undo/redo. No new npm dependencies.

## Motivation

The current description editing experience requires launching an external editor (`$EDITOR`), which breaks the TUI flow. A built-in editor enables future features like image paste/upload (inserting markdown image links inline) and provides a more integrated experience.

## Approach

**Build from scratch with Ink primitives (chosen).** Full control over document model, cursor, viewport scrolling, rendering with syntax highlighting, keybindings, and undo/redo. The cursor/scroll/render loop for a line-based editor is well-understood and the total implementation is ~400-600 lines of core logic.

**Rejected alternatives:**
- `ink-multiline-input` + custom layers — evaluated and rejected. The package (v0.1.0, single author, near-zero adoption) doesn't expose hooks for per-token rendering, has no way to intercept arbitrary keys (only `submit`/`newline`), and lacks undo/redo. We'd need to fork it anyway, at which point we're debugging unfamiliar code.
- `ink-multiline-input` as-is — no syntax highlighting possible, fragile key interception, dependent on unmaintained pre-1.0 package.

## Architecture

Three layers:

```
┌─────────────────────────────────────────┐
│  MarkdownEditor (React component)       │  Screen integration, layout, status bar
│  ┌───────────────────────────────────┐  │
│  │  editorStore (Zustand store)      │  │  Document model, cursor, undo stack
│  │  ┌───────────────────────────┐    │  │
│  │  │  highlightLine(line)      │    │  │  Regex tokenizer → Ink <Text> spans
│  │  └───────────────────────────┘    │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

- **editorStore** — Zustand vanilla store (same pattern as `listViewStore`, `formStackStore`). Pure logic, no React. Holds lines, cursor, undo stack. All mutations update state immutably. `init(content)` / `destroy()` lifecycle. Easily testable.
- **MarkdownEditor** — React component. Uses `useInput` for keybindings, renders lines through the highlight function, manages viewport layout.
- **highlightLine** — pure function. Takes a string, returns Ink `<Text>` elements with markdown styling.

### Document Model & Cursor

Store state shape:

```typescript
{
  lines: string[]                           // document split by \n
  cursor: { row: number, col: number }      // position in document
  goalCol: number                           // preserved column for vertical movement
  scrollOffset: number                      // first visible visual row
  undoStack: Snapshot[]                     // for Ctrl+Z (max 50)
  redoStack: Snapshot[]                     // for Ctrl+Shift+Z
  killBuffer: string                        // for Ctrl+K/U/Y
  dirty: boolean                            // changed since init?
}
```

Where `Snapshot` is `{ lines: string[], cursor: { row: number, col: number } }`.

**Cursor rules:**
- `col` clamped to `[0, lines[row].length]` (can sit one past end of line)
- Vertical movement preserves `goalCol` so moving past a short line and back to a long line remembers column position
- Home/Ctrl+A → col 0. End/Ctrl+E → col at line length.

**Undo/redo:**
- Every mutation that changes `lines` pushes a snapshot to `undoStack` and clears `redoStack`
- Ctrl+Z pops from undo, pushes current to redo, restores
- Ctrl+Shift+Z reverses
- Stack depth capped at 50

### Screen Integration

- New screen route `editor` added to `navigationStore` Screen type
- `MarkdownEditor` lazy-loaded in `app.tsx` like other screens
- **Entry:** From WorkItemForm, pressing Enter on description field → `editorStore.init(currentDescription)` → navigate to `editor`
- **Save (Ctrl+S):** Read `editorStore.getContent()` → write to form's description field via `formStackStore` → `editorStore.destroy()` → navigate back to `form`
- **Cancel (Esc):** If `dirty`, show discard prompt (matching WorkItemForm's `showDiscardPrompt` pattern): `"Discard changes? (d) discard  (esc) back to editor"`. If clean, navigate back immediately. On discard → `editorStore.destroy()` → navigate to `form`.

### Viewport & Scrolling

Full-screen layout:

```
┌─ Status bar (1 line) ──────────────────────┐
│  Editing: #42 Fix login bug    Ln 12, Col 8│
├─ Editor area (height - 2 lines) ───────────┤
│  ## Summary                                 │
│                                             │
│  This fixes the login bug by...             │
│  ▮                                          │
│                                             │
├─ Help bar (1 line) ────────────────────────┤
│  Ctrl+S Save  Esc Cancel  Ctrl+Z Undo      │
└─────────────────────────────────────────────┘
```

- Viewport height = terminal rows - 2 (status bar + help bar)
- **Soft-wrap:** Long lines wrap at terminal width. Each line's visual height = `ceil(line.length / terminalWidth)` (minimum 1).
- Scrolling counts in visual rows, not document lines. Cursor position maps to visual row via wrapping calculation.
- Follow-cursor: if cursor's visual row < scrollOffset → scroll up; if >= scrollOffset + viewportHeight → scroll down.

### Syntax Highlighting

Pure function `highlightLine(line: string) → React.ReactNode`. Regex-based, per-line, no AST.

**Token priority** (first match wins, scanned left-to-right):

| Token | Pattern | Style |
|---|---|---|
| Heading | `/^(#{1,6}\s)(.*)/` | Marker: bold+dim, text: bold+accent |
| Code span | `` /`[^`]+`/ `` | Distinct color (yellow) |
| Bold | `/\*\*(.+?)\*\*/` | Bold |
| Italic | `/\*(.+?)\*/` | Dim |
| Image link | `/!\[.*?\]\(.*?\)/` | Green |
| Link | `/\[.*?\]\(.*?\)/` | Blue+underline |
| Blockquote | `/^(>\s)(.*)/` | Marker: dim, text: dim |
| List bullet | `/^(\s*[-*+]\s)(.*)/` | Bullet: accent, text: normal |
| HR | `/^---+$/` | Dim |

Implementation: scan left-to-right, find earliest match across all patterns, emit styled span, advance past it, repeat. Code spans ranked high so markdown syntax inside backticks isn't styled.

### Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| **Navigation** | |
| Arrow Up/Down | Move cursor by line (respects goalCol) |
| Arrow Left/Right | Move cursor by character (wraps across lines) |
| Home / Ctrl+A | Start of line |
| End / Ctrl+E | End of line |
| Ctrl+Left/Right | Word jump (stop at word boundaries) |
| **Editing** | |
| Printable chars | Insert at cursor |
| Enter | Insert newline (split line at cursor) |
| Backspace | Delete char before cursor (join lines at col 0) |
| Delete | Delete char at cursor (join with next line at end) |
| Ctrl+K | Kill from cursor to end of line (store in kill buffer) |
| Ctrl+U | Kill from start of line to cursor (store in kill buffer) |
| Ctrl+W | Delete word backward |
| Ctrl+Y | Yank (paste kill buffer at cursor) |
| Tab | Insert spaces (default 2) |
| **Undo/Redo** | |
| Ctrl+Z | Undo |
| Ctrl+Shift+Z | Redo |
| **Save/Cancel** | |
| Ctrl+S | Save and return to form |
| Escape | Cancel (with discard prompt if dirty) |

Ctrl+C left to Ink default (exit app). Terminal-native copy/paste works via mouse selection.

## Dependencies

None. Built entirely with Ink primitives (`useInput`, `<Box>`, `<Text>`).

## Out of Scope (future work)

- Image paste/upload (issue #35, #36)
- Side-by-side rendered preview panel
- Markdown formatting hotkeys (Ctrl+B for bold, etc.)
- Text selection / copy-paste (terminal-native is sufficient)
- Fenced code block highlighting (multi-line state)

## Files

**New:**
- `src/stores/editorStore.ts` — Zustand vanilla store (document model, cursor, undo/redo, viewport)
- `src/stores/editorStore.test.ts` — pure logic tests
- `src/components/MarkdownEditor.tsx` — React component (layout, useInput, render)
- `src/components/markdownHighlight.ts` — pure function for syntax highlighting
- `src/components/markdownHighlight.test.ts` — tokenization tests

**Modified:**
- `src/stores/navigationStore.ts` — add `editor` to Screen type
- `src/app.tsx` — add lazy-loaded MarkdownEditor route
- `src/components/WorkItemForm.tsx` — description field navigates to editor screen

**Unchanged:**
- `src/editor.ts` — external `$EDITOR` helper kept in codebase but no longer called from WorkItemForm
