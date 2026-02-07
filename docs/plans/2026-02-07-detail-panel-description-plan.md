# Detail Panel: Expandable Description — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a description preview line to the detail panel and allow expanding to full scrollable description with `v`.

**Architecture:** Extend the existing `DetailPanel` component with a description prop and full-view mode. Add a new `useInput` block in `WorkItemList` for description scroll handling, gated by a `showFullDescription` local state boolean. Rebind panel toggle from `v` to `V`.

**Tech Stack:** React 19, Ink 6, TypeScript

**Design doc:** `docs/plans/2026-02-07-detail-panel-description-design.md`

---

### Task 1: Rebind panel toggle from `v` to `V`

**Files:**
- Modify: `src/components/WorkItemList.tsx:473`
- Modify: `src/components/HelpScreen.tsx:83`

**Step 1: Update the keybinding in WorkItemList**

In `src/components/WorkItemList.tsx`, change the panel toggle from `input === 'v'` to `input === 'V'`:

```typescript
      if (input === 'V') {
        void configStore
          .getState()
          .update({ showDetailPanel: !showDetailPanel });
      }
```

**Step 2: Update the help screen**

In `src/components/HelpScreen.tsx`, change line 83:

```typescript
      other.push({ key: 'V', description: 'Toggle detail panel' });
```

**Step 3: Run build to verify**

Run: `npm run build`
Expected: Clean compile

**Step 4: Commit**

```bash
git add src/components/WorkItemList.tsx src/components/HelpScreen.tsx
git commit -m "refactor: rebind detail panel toggle from v to V"
```

---

### Task 2: Add description preview line to DetailPanel

**Files:**
- Modify: `src/components/DetailPanel.tsx`

**Step 1: Write the test**

Create `src/components/DetailPanel.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { truncateDescription } from './DetailPanel.js';

describe('truncateDescription', () => {
  it('returns first line truncated to width', () => {
    const desc = 'This is a long description that should be truncated';
    expect(truncateDescription(desc, 20)).toBe('This is a long desc…');
  });

  it('returns full first line when shorter than width', () => {
    expect(truncateDescription('Short', 80)).toBe('Short');
  });

  it('returns empty string for empty description', () => {
    expect(truncateDescription('', 80)).toBe('');
  });

  it('uses only the first line of multi-line text', () => {
    const desc = 'First line\nSecond line\nThird line';
    expect(truncateDescription(desc, 80)).toBe('First line');
  });

  it('truncates first line of multi-line text when too long', () => {
    const desc = 'This is a very long first line\nSecond line';
    expect(truncateDescription(desc, 20)).toBe('This is a very long…');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/DetailPanel.test.ts`
Expected: FAIL — `truncateDescription` not exported

**Step 3: Implement truncateDescription and add preview line to DetailPanel**

In `src/components/DetailPanel.tsx`, add the utility function and update the component:

```typescript
import { Box, Text } from 'ink';
import type { WorkItem } from '../types.js';

function priorityColor(
  priority: string,
): 'red' | 'yellow' | 'cyan' | undefined {
  switch (priority) {
    case 'critical':
      return 'red';
    case 'high':
      return 'yellow';
    case 'medium':
      return 'cyan';
    default:
      return undefined;
  }
}

function priorityIcon(priority: string): string {
  switch (priority) {
    case 'critical':
      return '▲▲';
    case 'high':
      return '▲';
    case 'medium':
      return '●';
    case 'low':
      return '▽';
    default:
      return '';
  }
}

export function truncateDescription(description: string, width: number): string {
  if (!description) return '';
  const firstLine = description.split('\n')[0]!;
  if (firstLine.length <= width) return firstLine;
  return firstLine.slice(0, width - 1) + '…';
}

export function DetailPanel({
  item,
  terminalWidth,
  showFullDescription,
  descriptionScrollOffset,
  maxDescriptionHeight,
}: {
  item: WorkItem;
  terminalWidth: number;
  showFullDescription?: boolean;
  descriptionScrollOffset?: number;
  maxDescriptionHeight?: number;
}) {
  const metaParts: string[] = [`#${item.id}`, item.status];
  if (item.assignee) {
    metaParts.push(`@${item.assignee}`);
  }
  const metaLine = metaParts.join('  ·  ');

  const hasBottom = item.priority || item.labels.length > 0;
  const hasDescription = item.description.trim().length > 0;
  // Available width for text (account for paddingLeft=1)
  const contentWidth = terminalWidth - 1;

  const descriptionLines = hasDescription && showFullDescription
    ? item.description.split('\n')
    : [];
  const scrollOffset = descriptionScrollOffset ?? 0;
  const viewportHeight = maxDescriptionHeight ?? descriptionLines.length;
  const visibleLines = descriptionLines.slice(
    scrollOffset,
    scrollOffset + viewportHeight,
  );

  return (
    <Box
      flexDirection="column"
      marginTop={1}
      paddingLeft={1}
      width={terminalWidth}
    >
      <Box height={2}>
        <Text bold wrap="truncate">
          {item.title}
        </Text>
      </Box>
      <Box>
        <Text dimColor>{metaLine}</Text>
      </Box>
      {hasBottom && (
        <Box>
          {item.priority && (
            <Text color={priorityColor(item.priority)}>
              {priorityIcon(item.priority)} {item.priority}
            </Text>
          )}
          {item.priority && item.labels.length > 0 && (
            <Text dimColor>{'  '}</Text>
          )}
          {item.labels.length > 0 && (
            <Text dimColor>{item.labels.join(', ')}</Text>
          )}
        </Box>
      )}
      {hasDescription && !showFullDescription && (
        <Box>
          <Text dimColor wrap="truncate">
            {truncateDescription(item.description, contentWidth)}
          </Text>
        </Box>
      )}
      {showFullDescription && hasDescription && (
        <>
          <Box>
            <Text dimColor>
              {'─── description '}
              {'─'.repeat(Math.max(0, contentWidth - 17))}
            </Text>
          </Box>
          {visibleLines.map((line, idx) => (
            <Box key={idx}>
              <Text dimColor>{line || ' '}</Text>
            </Box>
          ))}
        </>
      )}
    </Box>
  );
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/DetailPanel.test.ts`
Expected: PASS

**Step 5: Run full build**

Run: `npm run build`
Expected: Clean compile

**Step 6: Commit**

```bash
git add src/components/DetailPanel.tsx src/components/DetailPanel.test.ts
git commit -m "feat(panel): add description preview line to detail panel"
```

---

### Task 3: Add full description toggle and scroll in WorkItemList

**Files:**
- Modify: `src/components/WorkItemList.tsx`

**Step 1: Add local state for description mode**

After line 148 (the `templates` state), add:

```typescript
  const [showFullDescription, setShowFullDescription] = useState(false);
  const [descriptionScrollOffset, setDescriptionScrollOffset] = useState(0);
```

**Step 2: Reset state on cursor movement**

Create a useEffect that resets description state when cursor changes:

```typescript
  useEffect(() => {
    setShowFullDescription(false);
    setDescriptionScrollOffset(0);
  }, [cursor]);
```

**Step 3: Compute description dimensions**

After the `viewport` calculation (line 289), add logic to compute the full description height. This needs to account for how many lines the description has versus how much space is available:

```typescript
  // Description viewport calculation for full mode
  const currentItem = treeItems[cursor]?.item;
  const descriptionLines = currentItem?.description?.split('\n') ?? [];
  const descriptionTotalLines = descriptionLines.length;

  // Chrome without detail panel: 6. Detail panel base: 5 (margin+title(2)+meta(1)+priority(1)+marginTop(1)).
  // In full mode, we also have: separator line (1).
  // We want at least 2 list rows visible.
  const { height: terminalHeight } = useTerminalSize();
  const minListRows = 2;
  const baseChromeLines = 6; // title+margin(2) + table header(1) + help bar margin+text(2) + warning(1)
  const panelBaseLines = 5; // marginTop(1) + title height(2) + meta(1) + priority/labels(1)
  const separatorLine = 1;

  const maxDescriptionHeight = showFullDescription
    ? Math.max(
        1,
        terminalHeight -
          baseChromeLines -
          panelBaseLines -
          separatorLine -
          minListRows,
      )
    : 0;

  // Dynamic chromeLines for scroll viewport
  const actualDescriptionViewHeight = showFullDescription
    ? Math.min(descriptionTotalLines, maxDescriptionHeight) + separatorLine
    : 0;

  const hasDescription = currentItem?.description?.trim().length ?? 0 > 0;
  const previewLine = showDetailPanel && hasDescription && !showFullDescription ? 1 : 0;

  const chromeLines = showDetailPanel
    ? 11 + previewLine + actualDescriptionViewHeight
    : 6;
```

Then update the `useScrollViewport` call to use the dynamic `chromeLines`:

```typescript
  const viewport = useScrollViewport({
    totalItems: treeItems.length,
    cursor,
    chromeLines,
    linesPerItem: 1,
  });
```

Note: The `useTerminalSize()` call already exists on line 207. Use that existing `terminalWidth` and add `height` to the destructuring — but check first: the `useTerminalSize` on line 207 only destructures `width`. The `useScrollViewport` hook internally calls `useTerminalSize` too. To avoid duplicate hook calls, import `height` from the existing call. Change line 207 to:

```typescript
  const { width: terminalWidth, height: terminalHeight } = useTerminalSize();
```

And remove the separate `useTerminalSize()` call in the description calculation block above (just use `terminalHeight` directly).

**Step 4: Add useInput block for description scroll**

Add a new useInput block (Block 1.5, between the overlay escape handler and the delete handler):

```typescript
  // Block 1.5: Description scroll handler — active when full description is shown
  useInput(
    (_input, key) => {
      if (_input === 'v' || key.escape) {
        setShowFullDescription(false);
        setDescriptionScrollOffset(0);
        return;
      }
      if (key.upArrow) {
        setDescriptionScrollOffset((o) => Math.max(0, o - 1));
      }
      if (key.downArrow) {
        const maxScroll = Math.max(0, descriptionTotalLines - maxDescriptionHeight);
        setDescriptionScrollOffset((o) => Math.min(maxScroll, o + 1));
      }
    },
    { isActive: showFullDescription && activeOverlay === null },
  );
```

**Step 5: Add `v` handler in main input block**

In the main input handler (Block 3), after the `V` panel toggle (which we changed in Task 1), add the `v` handler for description expand:

```typescript
      if (input === 'v' && showDetailPanel && hasDescription) {
        setShowFullDescription(true);
        setDescriptionScrollOffset(0);
      }
```

Note: The main input block has `isActive: activeOverlay === null`. The description scroll block has `isActive: showFullDescription && activeOverlay === null`. When `showFullDescription` is true, the description block captures `v`/escape/arrows. The main block should NOT be active when `showFullDescription` is true. Update the main input block's isActive:

```typescript
    { isActive: activeOverlay === null && !showFullDescription },
```

**Step 6: Pass new props to DetailPanel**

Update the DetailPanel render (around line 930-935):

```typescript
          {showDetailPanel && treeItems.length > 0 && treeItems[cursor] && (
            <DetailPanel
              item={treeItems[cursor].item}
              terminalWidth={terminalWidth}
              showFullDescription={showFullDescription}
              descriptionScrollOffset={descriptionScrollOffset}
              maxDescriptionHeight={maxDescriptionHeight}
            />
          )}
```

**Step 7: Update help bar for full description mode**

In the help bar section (the bottom `<Box marginTop={1}>` around line 937), add a condition for when `showFullDescription` is true. Before the existing overlay checks, add:

```typescript
            {showFullDescription ? (
              <Box>
                <Text dimColor>
                  ↑↓ scroll  v/esc close
                </Text>
                {positionText && <Text dimColor> {positionText}</Text>}
              </Box>
            ) : activeOverlay?.type === 'parent-input' ? (
```

This replaces the entire help bar when in full description mode.

**Step 8: Run build**

Run: `npm run build`
Expected: Clean compile

**Step 9: Commit**

```bash
git add src/components/WorkItemList.tsx
git commit -m "feat(panel): add full description toggle with v and scroll with arrows"
```

---

### Task 4: Update help screen keybinding docs

**Files:**
- Modify: `src/components/HelpScreen.tsx:82-83`

**Step 1: Add the `v` description keybinding**

In `src/components/HelpScreen.tsx`, after the `V` toggle entry (line 83 after Task 1), add:

```typescript
      other.push({ key: 'V', description: 'Toggle detail panel' });
      other.push({ key: 'v', description: 'Expand description' });
```

**Step 2: Run build**

Run: `npm run build`
Expected: Clean compile

**Step 3: Commit**

```bash
git add src/components/HelpScreen.tsx
git commit -m "docs: add v keybinding for description expand to help screen"
```

---

### Task 5: Run full verification

**Step 1: Run format**

Run: `npm run format`

**Step 2: Run lint**

Run: `npm run lint`

**Step 3: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 4: Run build**

Run: `npm run build`
Expected: Clean compile

**Step 5: Fix any issues found**

If any step fails, fix the issues and re-run.

**Step 6: Final commit (if formatting or lint fixes needed)**

```bash
git add -A
git commit -m "chore: format and lint fixes for description panel"
```
