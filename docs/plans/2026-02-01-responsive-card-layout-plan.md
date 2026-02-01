# Responsive Card Layout Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a card-based layout for the WorkItemList that activates below 80 columns and works down to ~35 columns, with dynamic switching on terminal resize.

**Architecture:** Extract the current table rendering from WorkItemList into a `TableLayout` sub-component, create a new `CardLayout` sub-component, and add a `useTerminalWidth` hook to switch between them reactively. All keyboard handling stays in the parent `WorkItemList`.

**Tech Stack:** React 19, Ink 6, TypeScript, Vitest

---

### Task 1: Create `useTerminalWidth` hook

**Files:**
- Create: `src/hooks/useTerminalWidth.ts`
- Test: `src/hooks/useTerminalWidth.test.ts`

**Step 1: Write the failing test**

```typescript
// src/hooks/useTerminalWidth.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

// We test the core logic, not the React hook itself
// The hook simply reads stdout.columns and listens for 'resize'
describe('useTerminalWidth logic', () => {
  it('returns stdout.columns value', () => {
    const stdout = Object.assign(new EventEmitter(), { columns: 120 });
    expect(stdout.columns).toBe(120);
  });

  it('defaults to 80 when columns is undefined', () => {
    const stdout = Object.assign(new EventEmitter(), { columns: undefined });
    expect(stdout.columns ?? 80).toBe(80);
  });

  it('emits resize event when terminal changes size', () => {
    const stdout = Object.assign(new EventEmitter(), { columns: 120 });
    const handler = vi.fn();
    stdout.on('resize', handler);
    stdout.columns = 40;
    stdout.emit('resize');
    expect(handler).toHaveBeenCalled();
    expect(stdout.columns).toBe(40);
  });
});
```

**Step 2: Run test to verify it passes** (this tests EventEmitter behavior, not our hook yet)

Run: `npx vitest run src/hooks/useTerminalWidth.test.ts`
Expected: PASS

**Step 3: Write the hook**

```typescript
// src/hooks/useTerminalWidth.ts
import { useState, useEffect } from 'react';
import { useStdout } from 'ink';

export function useTerminalWidth(): number {
  const { stdout } = useStdout();
  const [width, setWidth] = useState(stdout.columns || 80);

  useEffect(() => {
    const onResize = () => {
      setWidth(stdout.columns || 80);
    };
    stdout.on('resize', onResize);
    return () => {
      stdout.off('resize', onResize);
    };
  }, [stdout]);

  return width;
}
```

**Step 4: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add src/hooks/useTerminalWidth.ts src/hooks/useTerminalWidth.test.ts
git commit -m "feat: add useTerminalWidth hook for responsive layout"
```

---

### Task 2: Create `CardLayout` component

**Files:**
- Create: `src/components/CardLayout.tsx`
- Test: `src/components/CardLayout.test.ts`

**Step 1: Write failing tests for card formatting helpers**

```typescript
// src/components/CardLayout.test.ts
import { describe, it, expect } from 'vitest';
import { formatPriority, formatAssignee } from './CardLayout.js';

describe('CardLayout helpers', () => {
  describe('formatPriority', () => {
    it('returns arrow prefix for known priorities', () => {
      expect(formatPriority('high')).toBe('↑High');
      expect(formatPriority('High')).toBe('↑High');
      expect(formatPriority('medium')).toBe('→Med');
      expect(formatPriority('Medium')).toBe('→Med');
      expect(formatPriority('low')).toBe('↓Low');
      expect(formatPriority('Low')).toBe('↓Low');
    });

    it('returns empty string for empty/undefined priority', () => {
      expect(formatPriority('')).toBe('');
      expect(formatPriority(undefined)).toBe('');
    });

    it('returns raw value for unknown priorities', () => {
      expect(formatPriority('critical')).toBe('critical');
    });
  });

  describe('formatAssignee', () => {
    it('prefixes with @ if not already present', () => {
      expect(formatAssignee('alex')).toBe('@alex');
    });

    it('does not double-prefix', () => {
      expect(formatAssignee('@alex')).toBe('@alex');
    });

    it('returns empty string for empty/undefined', () => {
      expect(formatAssignee('')).toBe('');
      expect(formatAssignee(undefined)).toBe('');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/CardLayout.test.ts`
Expected: FAIL — module not found

**Step 3: Implement the CardLayout component with exported helpers**

```tsx
// src/components/CardLayout.tsx
import { Box, Text } from 'ink';
import type { BackendCapabilities } from '../backends/types.js';

interface TreeItem {
  item: {
    id: string;
    title: string;
    status: string;
    priority?: string;
    assignee?: string;
    dependsOn: string[];
  };
  depth: number;
  prefix: string;
}

interface CardLayoutProps {
  treeItems: TreeItem[];
  cursor: number;
  capabilities: BackendCapabilities;
}

export function formatPriority(priority: string | undefined): string {
  if (!priority) return '';
  const lower = priority.toLowerCase();
  if (lower === 'high') return '↑High';
  if (lower === 'medium' || lower === 'med') return '→Med';
  if (lower === 'low') return '↓Low';
  return priority;
}

export function formatAssignee(assignee: string | undefined): string {
  if (!assignee) return '';
  return assignee.startsWith('@') ? assignee : `@${assignee}`;
}

function statusColor(status: string): string {
  const lower = status.toLowerCase();
  if (lower === 'done' || lower === 'closed' || lower === 'resolved')
    return 'green';
  if (
    lower === 'in progress' ||
    lower === 'active' ||
    lower === 'in_progress'
  )
    return 'yellow';
  if (lower === 'blocked') return 'red';
  return 'blue';
}

export function CardLayout({ treeItems, cursor, capabilities }: CardLayoutProps) {
  if (treeItems.length === 0) return null;

  return (
    <Box flexDirection="column">
      {treeItems.map((treeItem, idx) => {
        const { item, depth } = treeItem;
        const selected = idx === cursor;
        const indent = '  '.repeat(depth);
        const marker = selected ? '>' : ' ';
        const hasDeps =
          capabilities.fields.dependsOn && item.dependsOn.length > 0;
        const depIndicator = hasDeps ? ' ⧗' : '';

        const metaParts: string[] = [];
        metaParts.push(`● ${item.status}`);
        if (capabilities.fields.priority) {
          const p = formatPriority(item.priority);
          if (p) metaParts.push(p);
        }
        if (capabilities.fields.assignee) {
          const a = formatAssignee(item.assignee);
          if (a) metaParts.push(a);
        }
        const metaLine = metaParts.join('  ');

        // Indent for meta line: align with title start
        // marker(1) + indent + '#'(1) + id + ' '(1) = offset
        const metaIndent = ' ' + indent + ' '.repeat(item.id.length + 2);

        return (
          <Box key={item.id} flexDirection="column" marginBottom={idx < treeItems.length - 1 ? 1 : 0}>
            <Box>
              <Text
                color={selected ? 'cyan' : undefined}
                bold={selected}
                inverse={selected}
              >
                {marker}
                {indent}#{item.id} {item.title}
                {depIndicator}
              </Text>
            </Box>
            <Box>
              <Text
                color={selected ? 'cyan' : undefined}
                inverse={selected}
              >
                {metaIndent}
              </Text>
              <Text color={statusColor(item.status)} inverse={selected}>●</Text>
              <Text
                color={selected ? 'cyan' : undefined}
                inverse={selected}
              >
                {' '}{item.status}
                {capabilities.fields.priority && formatPriority(item.priority) ? '  ' + formatPriority(item.priority) : ''}
                {capabilities.fields.assignee && formatAssignee(item.assignee) ? '  ' + formatAssignee(item.assignee) : ''}
              </Text>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/CardLayout.test.ts`
Expected: PASS

**Step 5: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 6: Commit**

```bash
git add src/components/CardLayout.tsx src/components/CardLayout.test.ts
git commit -m "feat: add CardLayout component for compact terminal display"
```

---

### Task 3: Extract `TableLayout` from WorkItemList

**Files:**
- Create: `src/components/TableLayout.tsx`
- Modify: `src/components/WorkItemList.tsx`

**Step 1: Create TableLayout by extracting the existing table rendering**

Extract lines 259-339 of `WorkItemList.tsx` (header + rows) into a new component:

```tsx
// src/components/TableLayout.tsx
import { Box, Text } from 'ink';
import type { BackendCapabilities } from '../backends/types.js';

interface TreeItem {
  item: {
    id: string;
    title: string;
    status: string;
    priority?: string;
    assignee?: string;
    dependsOn: string[];
  };
  depth: number;
  prefix: string;
}

interface TableLayoutProps {
  treeItems: TreeItem[];
  cursor: number;
  capabilities: BackendCapabilities;
}

const colId = 5;
const colStatus = 14;
const colPriority = 10;
const colAssignee = 12;

export function TableLayout({ treeItems, cursor, capabilities }: TableLayoutProps) {
  return (
    <>
      <Box>
        <Box width={2}>
          <Text> </Text>
        </Box>
        <Box width={colId}>
          <Text bold underline>
            ID
          </Text>
        </Box>
        <Box flexGrow={1}>
          <Text bold underline>
            Title
          </Text>
        </Box>
        <Box width={colStatus}>
          <Text bold underline>
            Status
          </Text>
        </Box>
        {capabilities.fields.priority && (
          <Box width={colPriority}>
            <Text bold underline>
              Priority
            </Text>
          </Box>
        )}
        {capabilities.fields.assignee && (
          <Box width={colAssignee}>
            <Text bold underline>
              Assignee
            </Text>
          </Box>
        )}
      </Box>

      {treeItems.map((treeItem, idx) => {
        const { item, prefix } = treeItem;
        const selected = idx === cursor;
        const hasUnresolvedDeps = item.dependsOn.length > 0;
        return (
          <Box key={item.id}>
            <Box width={2}>
              <Text color="cyan">{selected ? '>' : ' '}</Text>
            </Box>
            <Box width={colId}>
              <Text color={selected ? 'cyan' : undefined}>{item.id}</Text>
            </Box>
            <Box flexGrow={1}>
              <Text color={selected ? 'cyan' : undefined} bold={selected}>
                {capabilities.relationships ? prefix : ''}
                {item.title}
              </Text>
            </Box>
            <Box width={colStatus}>
              <Text color={selected ? 'cyan' : undefined}>
                {capabilities.fields.dependsOn && hasUnresolvedDeps ? '⧗ ' : ''}
                {item.status}
              </Text>
            </Box>
            {capabilities.fields.priority && (
              <Box width={colPriority}>
                <Text color={selected ? 'cyan' : undefined}>
                  {item.priority}
                </Text>
              </Box>
            )}
            {capabilities.fields.assignee && (
              <Box width={colAssignee}>
                <Text color={selected ? 'cyan' : undefined}>
                  {item.assignee}
                </Text>
              </Box>
            )}
          </Box>
        );
      })}
    </>
  );
}
```

**Step 2: Update WorkItemList to use TableLayout**

In `src/components/WorkItemList.tsx`:

- Add imports: `import { TableLayout } from './TableLayout.js';`
- Remove lines 245-248 (column width constants)
- Replace lines 259-339 (header + row rendering) with: `<TableLayout treeItems={treeItems} cursor={cursor} capabilities={capabilities} />`
- Keep everything else (state, keyboard handling, status bar, modals) unchanged

**Step 3: Verify build and run app**

Run: `npx tsc --noEmit`
Expected: No errors

Run: `npm test`
Expected: All existing tests pass

**Step 4: Commit**

```bash
git add src/components/TableLayout.tsx src/components/WorkItemList.tsx
git commit -m "refactor: extract TableLayout from WorkItemList"
```

---

### Task 4: Wire up layout switching in WorkItemList

**Files:**
- Modify: `src/components/WorkItemList.tsx`

**Step 1: Add terminal width detection and conditional rendering**

In `src/components/WorkItemList.tsx`:

- Add import: `import { CardLayout } from './CardLayout.js';`
- Add import: `import { useTerminalWidth } from '../hooks/useTerminalWidth.js';`
- Inside the `WorkItemList` component, add: `const terminalWidth = useTerminalWidth();`
- Replace the `<TableLayout ... />` with:

```tsx
{terminalWidth >= 80 ? (
  <TableLayout treeItems={treeItems} cursor={cursor} capabilities={capabilities} />
) : (
  <CardLayout treeItems={treeItems} cursor={cursor} capabilities={capabilities} />
)}
```

**Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Manual test — resize terminal**

Run: `npm start`
- At full width (80+): should show table layout (unchanged)
- Resize to <80: should switch to card layout
- Resize back: should switch back to table

**Step 4: Commit**

```bash
git add src/components/WorkItemList.tsx
git commit -m "feat: switch between table and card layout based on terminal width"
```

---

### Task 5: Add compact status bar

**Files:**
- Modify: `src/components/WorkItemList.tsx`

**Step 1: Add compact help text**

In `src/components/WorkItemList.tsx`, after the existing `helpText` construction (lines 230-243), add a compact variant:

```typescript
const compactHelpParts = [
  '↑↓ Nav',
  'c New',
  '⏎ Edit',
  's Status',
  'q Quit',
];
const compactHelpText = compactHelpParts.join('  ');
```

**Step 2: Use terminal width to select help text**

Replace the status bar `<Text dimColor>{helpText}</Text>` (line 369) with:

```tsx
<Text dimColor>{terminalWidth >= 80 ? helpText : compactHelpText}</Text>
```

**Step 3: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Manual test**

Run: `npm start`
- Wide terminal: full status bar
- Narrow terminal: compact status bar showing only Nav/New/Edit/Status/Quit

**Step 5: Commit**

```bash
git add src/components/WorkItemList.tsx
git commit -m "feat: show compact status bar on narrow terminals"
```

---

### Task 6: Handle empty state in card layout

**Files:**
- Modify: `src/components/WorkItemList.tsx`

**Step 1: Verify empty state works in both modes**

The existing empty state (`No {activeType}s in this iteration.`) is rendered outside the layout components. Verify it still renders correctly in card mode.

Check the current code — the empty state block (lines 294-298) is rendered independently of the table/card layout. It should work as-is.

**Step 2: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 3: Run lint and format**

Run: `npm run lint:fix && npm run format`
Expected: No errors

**Step 4: Commit if any formatting changes**

```bash
git add -u
git commit -m "chore: lint and format"
```

---

### Task 7: Final verification

**Step 1: Full build check**

Run: `npm run build`
Expected: Clean build

**Step 2: Full test suite**

Run: `npm test`
Expected: All tests pass

**Step 3: Type check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Manual verification at various widths**

Run: `npm start`
Test at: 35, 60, 80, 120 columns

Verify:
- Card layout renders at <80
- Table layout renders at >=80
- Selection (`>` marker + color) works in both
- Tree indentation works in card mode
- Status bar switches between compact/full
- All keyboard shortcuts work in both modes
- Resizing switches layout dynamically
- Cursor position preserved across switches
