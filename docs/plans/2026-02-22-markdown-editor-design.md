# Built-in Markdown Editor Design

**Date:** 2026-02-22
**Status:** Approved

## Summary

Replace the external `$EDITOR` workflow for description editing with a built-in full-screen markdown editor. Uses `ink-multiline-input` as the base with a custom syntax highlighting layer and readline-style keyboard shortcuts.

## Motivation

The current description editing experience requires launching an external editor (`$EDITOR`), which breaks the TUI flow. A built-in editor enables future features like image paste/upload (inserting markdown image links inline) and provides a more integrated experience.

## Approach

**Approach 1 (chosen):** `ink-multiline-input` + custom highlight layer. Leverages the maintained package for cursor management, scrolling, and key handling. Custom layers add markdown syntax highlighting and readline shortcuts on top. If API limitations are hit, fallback is to fork the package.

**Rejected alternatives:**
- Build from scratch — too much effort for cursor/scroll logic
- Fork `ink-multiline-input` — unnecessary upfront; can fall back to this if needed

## Architecture

A new `MarkdownEditor` screen (full-screen takeover) accessible from WorkItemForm when the user activates the description field.

```
WorkItemForm
  press Enter on description field
    navigate to "editor" screen (full-screen)
      MarkdownEditor component
        Status bar (top): context info, line:col
        ink-multiline-input (center): editable text with highlighted rendering
        Help bar (bottom): Ctrl+S save, Esc cancel, shortcuts
```

### Screen Integration

- New screen route `editor` in AppContext alongside `list`, `form`, `help`, etc.
- On save (Ctrl+S): returns description text to formStackStore, navigates back to `form`.
- On cancel (Esc): discards changes, navigates back to `form`.

### Syntax Highlighting

Simple regex tokenizer applied per-line. No AST, no external library.

| Markdown element | Pattern | Style |
|---|---|---|
| `# Heading` | `/^#{1,6}\s/` | Bold + accent color |
| `**bold**` | `/\*\*.*?\*\*/` | Bold |
| `*italic*` | `/\*.*?\*/` | Italic (dim) |
| `` `code` `` | `/`.*?`/` | Distinct color |
| `[link](url)` | `/\[.*?\]\(.*?\)/` | Blue/underline |
| `- list item` | `/^\s*[-*+]\s/` | Accent color for bullet |
| `> blockquote` | `/^>\s/` | Dim/muted |
| `---` | `/^---+$/` | Dim horizontal rule |
| `![img](url)` | `/!\[.*?\]\(.*?\)/` | Green (image links) |

### Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| Ctrl+A | Jump to start of line |
| Ctrl+E | Jump to end of line |
| Ctrl+K | Kill from cursor to end of line |
| Ctrl+U | Kill from start of line to cursor |
| Ctrl+W | Delete word backward |
| Ctrl+S | Save and return to form |
| Esc | Cancel and return to form |
| Arrow keys | Cursor movement (handled by ink-multiline-input) |
| Home/End | Start/end of line |

## Dependencies

- `ink-multiline-input` — new npm dependency for multiline text input

## Out of Scope (future work)

- Image paste/upload (upload to backend, insert markdown link)
- Side-by-side rendered preview panel
- Markdown formatting hotkeys (Ctrl+B for bold, etc.)
- Text selection / copy-paste
- Undo/redo within the editor

## Files Affected

- `src/app.tsx` — add `editor` screen route
- `src/components/MarkdownEditor.tsx` — new component
- `src/components/WorkItemForm.tsx` — change description field to navigate to editor screen
- `src/stores/navigationStore.ts` — add `editor` screen type
- `package.json` — add `ink-multiline-input` dependency
