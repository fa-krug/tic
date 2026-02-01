# Responsive Card Layout Design

## Problem

The WorkItemList table has hardcoded column widths and no terminal width detection. On small screens (especially mobile terminals at ~35-40 columns), the table layout breaks and becomes unreadable.

## Solution

Introduce a card-based layout that activates below 80 columns, with the existing table preserved for wide terminals. The layout switches dynamically as the terminal resizes.

## Layout Modes

### Wide (80+ columns): Table

The current table layout, unchanged:

```
  ID    Title              Status         Priority   Assignee
> #1    Auth redesign      Open           High       @alex
  #3    Fix login bug      In Progress    Med        @alex
```

### Compact (<80 columns): Cards

Each work item renders as a two-line card:

```
> #3 Fix the login bug
     ● In Progress  ↑High  @alex
```

**Line 1:** Selection marker (`>`) + item ID + title. Title wraps if it exceeds terminal width.

**Line 2:** Indented to align with title start. Contains:

- Colored status dot (`●`) with color mapped to status (green = done, yellow = in progress, etc.)
- Priority indicator if supported by backend: `↑High`, `→Med`, `↓Low`
- Assignee if supported and set: `@name`
- Missing optional fields are omitted, not shown as empty placeholders

**Selection:** Selected item gets `>` marker plus inverse/bold background color on the whole card. Unselected items render without marker, normal colors.

**Separators:** Blank line between items. If height is very constrained, the two-line card structure provides enough visual separation without extra blank lines.

**Dependencies indicator:** Shown on line 1 after the title:

```
> #5 Deploy to production ⧗
     ● Blocked  ↑High  @alex
```

### Tree Hierarchy

In card mode, child items are indented by 2 characters per nesting level. The `>` selection marker replaces the first character of the indent space:

```
  #1 Auth system redesign
     ● Open  ↑High
>   #3 Fix the login bug
       ● In Progress  ↑Med  @alex
    #7 Add OAuth support
       ● Open  ↑Low  @dana
```

## Compact Status Bar

Card mode uses a slimmer status bar showing only the most common shortcuts:

```
↑↓ Nav  c New  ⏎ Edit  s Status  q Quit
```

All keyboard shortcuts remain functional in card mode; the compact bar just hides less-common ones (`d` delete, `p` parent, `Tab` type, `i` iteration). The status bar is a single dimmed line at the bottom, truncated to terminal width if needed.

Table mode keeps the current full status bar.

## Terminal Width Detection

Use Ink's `useStdout()` hook to read terminal dimensions reactively. The layout switches live as the terminal resizes. The selected item index is preserved across layout changes.

## Implementation Scope

### New

- Terminal width detection via `useStdout()` in WorkItemList
- Card renderer (new sub-component or inline in WorkItemList)
- Compact status bar variant

### Unchanged

- All keyboard handling (same keys, same behavior in both modes)
- WorkItemForm (already vertical/flexible layout)
- IterationPicker (already works fine)
- All backend logic
- CLI commands
- Dependency/children warning overlays (modal, width-independent)

### Refactoring

- WorkItemList conditionally renders based on width: `width >= 80 ? <TableLayout /> : <CardLayout />`
- Extract current column/row rendering into a `TableLayout` sub-component
- New `CardLayout` sibling component for the compact view
- Extract status bar into its own component with a `compact` prop
