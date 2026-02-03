# Bulk Operations Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add multi-select and bulk operations to the TUI list view, enabling users to mark items and apply actions to all marked items at once.

**Architecture:** Add `markedIds: Set<string>` state to WorkItemList. Modify existing action handlers to check for marks and operate on marked items when present. Add a BulkMenu overlay component for discoverability. Update TableLayout and CardLayout to render marked items with distinct background.

**Tech Stack:** React 19, Ink 6, TypeScript

---

## Task 1: Add marked state to WorkItemList

**Files:**
- Modify: `src/components/WorkItemList.tsx:32-38`

**Step 1: Add markedIds state**

Add a new state variable after the existing state declarations (around line 38):

```typescript
const [markedIds, setMarkedIds] = useState<Set<string>>(() => new Set());
```

**Step 2: Add helper to compute marked count**

Add a computed value for the header display:

```typescript
const markedCount = markedIds.size;
```

**Step 3: Run TypeScript to verify no errors**

Run: `npm run build`
Expected: Build succeeds with no errors

**Step 4: Commit**

```bash
git add src/components/WorkItemList.tsx
git commit -m "feat(bulk): add markedIds state to WorkItemList"
```

---

## Task 2: Add m key to toggle mark

**Files:**
- Modify: `src/components/WorkItemList.tsx` (in useInput handler, around line 290)

**Step 1: Add m key handler**

After the `if (input === 'r' && syncManager)` block (around line 293), add:

```typescript
if (input === 'm' && treeItems.length > 0) {
  const itemId = treeItems[cursor]!.item.id;
  setMarkedIds((prev) => {
    const next = new Set(prev);
    if (next.has(itemId)) {
      next.delete(itemId);
    } else {
      next.add(itemId);
    }
    return next;
  });
}
```

**Step 2: Run TypeScript to verify no errors**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/components/WorkItemList.tsx
git commit -m "feat(bulk): add m key to toggle item mark"
```

---

## Task 3: Add M key to clear all marks

**Files:**
- Modify: `src/components/WorkItemList.tsx` (in useInput handler)

**Step 1: Add M key handler**

After the `if (input === 'm' ...)` block, add:

```typescript
if (input === 'M') {
  setMarkedIds(new Set());
}
```

**Step 2: Run TypeScript to verify no errors**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/components/WorkItemList.tsx
git commit -m "feat(bulk): add M key to clear all marks"
```

---

## Task 4: Pass markedIds to TableLayout

**Files:**
- Modify: `src/components/WorkItemList.tsx:371-376`
- Modify: `src/components/TableLayout.tsx:7-11,18-23`

**Step 1: Update TableLayoutProps interface**

In `src/components/TableLayout.tsx`, add `markedIds` to the interface:

```typescript
interface TableLayoutProps {
  treeItems: TreeItem[];
  cursor: number;
  capabilities: BackendCapabilities;
  collapsedIds: Set<string>;
  markedIds: Set<string>;
}
```

**Step 2: Destructure markedIds in TableLayout**

Update the function signature:

```typescript
export function TableLayout({
  treeItems,
  cursor,
  capabilities,
  collapsedIds,
  markedIds,
}: TableLayoutProps) {
```

**Step 3: Pass markedIds from WorkItemList**

In `src/components/WorkItemList.tsx`, update the TableLayout call:

```typescript
<TableLayout
  treeItems={visibleTreeItems}
  cursor={viewport.visibleCursor}
  capabilities={capabilities}
  collapsedIds={collapsedIds}
  markedIds={markedIds}
/>
```

**Step 4: Run TypeScript to verify no errors**

Run: `npm run build`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add src/components/WorkItemList.tsx src/components/TableLayout.tsx
git commit -m "feat(bulk): pass markedIds to TableLayout"
```

---

## Task 5: Pass markedIds to CardLayout

**Files:**
- Modify: `src/components/WorkItemList.tsx:378-383`
- Modify: `src/components/CardLayout.tsx:5-10,36-41`

**Step 1: Update CardLayoutProps interface**

In `src/components/CardLayout.tsx`, add `markedIds` to the interface:

```typescript
interface CardLayoutProps {
  treeItems: TreeItem[];
  cursor: number;
  capabilities: BackendCapabilities;
  collapsedIds: Set<string>;
  markedIds: Set<string>;
}
```

**Step 2: Destructure markedIds in CardLayout**

Update the function signature:

```typescript
export function CardLayout({
  treeItems,
  cursor,
  capabilities,
  collapsedIds,
  markedIds,
}: CardLayoutProps) {
```

**Step 3: Pass markedIds from WorkItemList**

In `src/components/WorkItemList.tsx`, update the CardLayout call:

```typescript
<CardLayout
  treeItems={visibleTreeItems}
  cursor={viewport.visibleCursor}
  capabilities={capabilities}
  collapsedIds={collapsedIds}
  markedIds={markedIds}
/>
```

**Step 4: Run TypeScript to verify no errors**

Run: `npm run build`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add src/components/WorkItemList.tsx src/components/CardLayout.tsx
git commit -m "feat(bulk): pass markedIds to CardLayout"
```

---

## Task 6: Render marked items with distinct background in TableLayout

**Files:**
- Modify: `src/components/TableLayout.tsx:69-142`

**Step 1: Add marked check in row rendering**

In the map function, add a check for marked state after the `selected` declaration:

```typescript
const marked = markedIds.has(item.id);
```

**Step 2: Apply background color to marked rows**

Wrap each row's Box with conditional background. Replace the outer `<Box key={...}>` with:

```typescript
<Box
  key={`${item.id}-${item.type}`}
  {...(marked && !selected ? { backgroundColor: 'cyan' } : {})}
>
```

Note: Ink uses `backgroundColor` prop. When marked but not selected, use dim cyan. When selected, cursor highlight takes precedence (existing cyan text styling).

**Step 3: Run TypeScript to verify no errors**

Run: `npm run build`
Expected: Build succeeds

**Step 4: Manual test**

Run: `npm start`
Navigate to items, press `m` to mark, verify background color appears.

**Step 5: Commit**

```bash
git add src/components/TableLayout.tsx
git commit -m "feat(bulk): render marked items with background in TableLayout"
```

---

## Task 7: Render marked items with distinct background in CardLayout

**Files:**
- Modify: `src/components/CardLayout.tsx:46-106`

**Step 1: Add marked check in card rendering**

After the `selected` declaration, add:

```typescript
const marked = markedIds.has(item.id);
```

**Step 2: Apply background color to marked cards**

Update the outer Box for each card:

```typescript
<Box
  key={`${item.id}-${item.type}`}
  flexDirection="column"
  marginBottom={idx < treeItems.length - 1 ? 1 : 0}
  {...(marked && !selected ? { backgroundColor: 'cyan' } : {})}
>
```

**Step 3: Run TypeScript to verify no errors**

Run: `npm run build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/components/CardLayout.tsx
git commit -m "feat(bulk): render marked items with background in CardLayout"
```

---

## Task 8: Display marked count in header

**Files:**
- Modify: `src/components/WorkItemList.tsx:345-368`

**Step 1: Add marked count display**

In the header Box (around line 345), after the sync status display, add the marked count indicator:

```typescript
{markedCount > 0 && (
  <Text color="magenta">{` ● ${markedCount} marked`}</Text>
)}
```

Insert this after the sync status conditional block and before the closing `</Box>`.

**Step 2: Run TypeScript to verify no errors**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Manual test**

Run: `npm start`
Mark some items with `m`, verify "● N marked" appears in header.

**Step 4: Commit**

```bash
git add src/components/WorkItemList.tsx
git commit -m "feat(bulk): display marked count in header"
```

---

## Task 9: Add helper to get target item IDs

**Files:**
- Modify: `src/components/WorkItemList.tsx` (add helper function before component)

**Step 1: Add getTargetIds helper**

Before the `WorkItemList` function, add:

```typescript
function getTargetIds(
  markedIds: Set<string>,
  cursorItem: { id: string } | undefined,
): string[] {
  if (markedIds.size > 0) {
    return [...markedIds];
  }
  return cursorItem ? [cursorItem.id] : [];
}
```

**Step 2: Run TypeScript to verify no errors**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/components/WorkItemList.tsx
git commit -m "feat(bulk): add getTargetIds helper function"
```

---

## Task 10: Make delete action bulk-aware

**Files:**
- Modify: `src/components/WorkItemList.tsx` (delete handler and confirmation)

**Step 1: Store target IDs for delete**

Add state to track pending delete IDs (after other state declarations):

```typescript
const [deleteTargetIds, setDeleteTargetIds] = useState<string[]>([]);
```

**Step 2: Update d key handler**

Replace the existing `if (input === 'd' ...)` block:

```typescript
if (input === 'd' && treeItems.length > 0) {
  const targetIds = getTargetIds(markedIds, treeItems[cursor]?.item);
  if (targetIds.length > 0) {
    setDeleteTargetIds(targetIds);
    setConfirmDelete(true);
  }
}
```

**Step 3: Update delete confirmation handler**

Replace the existing delete confirmation block in useInput:

```typescript
if (confirmDelete) {
  if (input === 'y' || input === 'Y') {
    void (async () => {
      for (const id of deleteTargetIds) {
        await backend.cachedDeleteWorkItem(id);
        await queueWrite('delete', id);
      }
      setConfirmDelete(false);
      setDeleteTargetIds([]);
      setMarkedIds((prev) => {
        const next = new Set(prev);
        for (const id of deleteTargetIds) {
          next.delete(id);
        }
        return next;
      });
      setCursor((c) => Math.max(0, c - 1));
      refreshData();
    })();
  } else {
    setConfirmDelete(false);
    setDeleteTargetIds([]);
  }
  return;
}
```

**Step 4: Update delete confirmation message**

In the render section, update the confirmation text:

```typescript
confirmDelete ? (
  <Text color="red">
    Delete {deleteTargetIds.length} item{deleteTargetIds.length > 1 ? 's' : ''}? (y/n)
  </Text>
)
```

**Step 5: Run TypeScript to verify no errors**

Run: `npm run build`
Expected: Build succeeds

**Step 6: Commit**

```bash
git add src/components/WorkItemList.tsx
git commit -m "feat(bulk): make delete action bulk-aware"
```

---

## Task 11: Make set parent action bulk-aware

**Files:**
- Modify: `src/components/WorkItemList.tsx` (parent handler)

**Step 1: Store parent target IDs**

Add state (after deleteTargetIds):

```typescript
const [parentTargetIds, setParentTargetIds] = useState<string[]>([]);
```

**Step 2: Update p key handler**

Replace the existing `if (input === 'p' ...)` block:

```typescript
if (
  input === 'p' &&
  capabilities.fields.parent &&
  treeItems.length > 0 &&
  !settingParent
) {
  const targetIds = getTargetIds(markedIds, treeItems[cursor]?.item);
  if (targetIds.length > 0) {
    setParentTargetIds(targetIds);
    setSettingParent(true);
    // For single item, prefill current parent
    if (targetIds.length === 1) {
      const item = treeItems.find((t) => t.item.id === targetIds[0]);
      setParentInput(item?.item.parent ?? '');
    } else {
      setParentInput('');
    }
  }
}
```

**Step 3: Update parent submit handler**

In the render section, update the onSubmit handler for parent input:

```typescript
onSubmit={(value) => {
  void (async () => {
    const newParent = value.trim() === '' ? null : value.trim();
    try {
      for (const id of parentTargetIds) {
        await backend.cachedUpdateWorkItem(id, { parent: newParent });
        await queueWrite('update', id);
      }
      setWarning('');
    } catch (e) {
      setWarning(e instanceof Error ? e.message : 'Invalid parent');
    }
    setSettingParent(false);
    setParentInput('');
    setParentTargetIds([]);
    refreshData();
  })();
}}
```

**Step 4: Update parent prompt text**

Update the prompt to show count:

```typescript
<Text color="cyan">
  Set parent for {parentTargetIds.length} item{parentTargetIds.length > 1 ? 's' : ''} (empty to clear):{' '}
</Text>
```

**Step 5: Run TypeScript to verify no errors**

Run: `npm run build`
Expected: Build succeeds

**Step 6: Commit**

```bash
git add src/components/WorkItemList.tsx
git commit -m "feat(bulk): make set parent action bulk-aware"
```

---

## Task 12: Create PriorityPicker component

**Files:**
- Create: `src/components/PriorityPicker.tsx`

**Step 1: Create the component file**

```typescript
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';

interface PriorityPickerProps {
  onSelect: (priority: 'low' | 'medium' | 'high' | 'critical') => void;
  onCancel: () => void;
}

const PRIORITIES: Array<{ label: string; value: 'low' | 'medium' | 'high' | 'critical' }> = [
  { label: 'Critical', value: 'critical' },
  { label: 'High', value: 'high' },
  { label: 'Medium', value: 'medium' },
  { label: 'Low', value: 'low' },
];

export function PriorityPicker({ onSelect, onCancel }: PriorityPickerProps) {
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Set Priority</Text>
      </Box>
      <SelectInput
        items={PRIORITIES}
        onSelect={(item) => onSelect(item.value)}
      />
      <Box marginTop={1}>
        <Text dimColor>{'↑↓ navigate  enter select  esc cancel'}</Text>
      </Box>
    </Box>
  );
}
```

**Step 2: Run TypeScript to verify no errors**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/components/PriorityPicker.tsx
git commit -m "feat(bulk): create PriorityPicker component"
```

---

## Task 13: Create TypePicker component

**Files:**
- Create: `src/components/TypePicker.tsx`

**Step 1: Create the component file**

```typescript
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';

interface TypePickerProps {
  types: string[];
  onSelect: (type: string) => void;
  onCancel: () => void;
}

export function TypePicker({ types, onSelect, onCancel }: TypePickerProps) {
  useInput((_input, key) => {
    if (key.escape) {
      onCancel();
    }
  });

  const items = types.map((t) => ({
    label: t.charAt(0).toUpperCase() + t.slice(1),
    value: t,
  }));

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Set Type</Text>
      </Box>
      <SelectInput items={items} onSelect={(item) => onSelect(item.value)} />
      <Box marginTop={1}>
        <Text dimColor>{'↑↓ navigate  enter select  esc cancel'}</Text>
      </Box>
    </Box>
  );
}
```

**Step 2: Run TypeScript to verify no errors**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/components/TypePicker.tsx
git commit -m "feat(bulk): create TypePicker component"
```

---

## Task 14: Create StatusPicker component

**Files:**
- Create: `src/components/StatusPicker.tsx`

**Step 1: Create the component file**

```typescript
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';

interface StatusPickerProps {
  statuses: string[];
  onSelect: (status: string) => void;
  onCancel: () => void;
}

export function StatusPicker({ statuses, onSelect, onCancel }: StatusPickerProps) {
  useInput((_input, key) => {
    if (key.escape) {
      onCancel();
    }
  });

  const items = statuses.map((s) => ({
    label: s,
    value: s,
  }));

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Set Status</Text>
      </Box>
      <SelectInput items={items} onSelect={(item) => onSelect(item.value)} />
      <Box marginTop={1}>
        <Text dimColor>{'↑↓ navigate  enter select  esc cancel'}</Text>
      </Box>
    </Box>
  );
}
```

**Step 2: Run TypeScript to verify no errors**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/components/StatusPicker.tsx
git commit -m "feat(bulk): create StatusPicker component"
```

---

## Task 15: Create BulkMenu component

**Files:**
- Create: `src/components/BulkMenu.tsx`

**Step 1: Create the component file**

```typescript
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import type { BackendCapabilities } from '../backends/types.js';

export type BulkAction =
  | 'status'
  | 'iteration'
  | 'parent'
  | 'type'
  | 'priority'
  | 'assignee'
  | 'labels'
  | 'delete';

interface BulkMenuProps {
  itemCount: number;
  capabilities: BackendCapabilities;
  onSelect: (action: BulkAction) => void;
  onCancel: () => void;
}

export function BulkMenu({
  itemCount,
  capabilities,
  onSelect,
  onCancel,
}: BulkMenuProps) {
  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    // Shortcut keys
    const shortcuts: Record<string, BulkAction> = {
      s: 'status',
      i: 'iteration',
      p: 'parent',
      t: 'type',
      P: 'priority',
      a: 'assignee',
      l: 'labels',
      d: 'delete',
    };
    const action = shortcuts[input];
    if (action) {
      onSelect(action);
    }
  });

  const items: Array<{ label: string; value: BulkAction }> = [];

  items.push({ label: 'Set status...              (s)', value: 'status' });

  if (capabilities.iterations) {
    items.push({ label: 'Set iteration...           (i)', value: 'iteration' });
  }

  if (capabilities.fields.parent) {
    items.push({ label: 'Set parent...              (p)', value: 'parent' });
  }

  if (capabilities.customTypes) {
    items.push({ label: 'Set type...                (t)', value: 'type' });
  }

  if (capabilities.fields.priority) {
    items.push({ label: 'Set priority...            (P)', value: 'priority' });
  }

  if (capabilities.fields.assignee) {
    items.push({ label: 'Set assignee...            (a)', value: 'assignee' });
  }

  if (capabilities.fields.labels) {
    items.push({ label: 'Set labels...              (l)', value: 'labels' });
  }

  items.push({ label: '─────────────────────────────', value: 'status' }); // separator (won't be selectable in practice)
  items.push({ label: 'Delete                     (d)', value: 'delete' });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Bulk Actions ({itemCount} {itemCount === 1 ? 'item' : 'items'})
        </Text>
      </Box>
      <SelectInput
        items={items.filter((i) => !i.label.startsWith('─'))}
        onSelect={(item) => onSelect(item.value)}
      />
      <Box marginTop={1}>
        <Text dimColor>↑↓ navigate  enter select  esc cancel</Text>
      </Box>
    </Box>
  );
}
```

**Step 2: Run TypeScript to verify no errors**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/components/BulkMenu.tsx
git commit -m "feat(bulk): create BulkMenu component"
```

---

## Task 16: Add bulk menu state and b key handler

**Files:**
- Modify: `src/components/WorkItemList.tsx`

**Step 1: Import BulkMenu and BulkAction**

Add to imports:

```typescript
import { BulkMenu, type BulkAction } from './BulkMenu.js';
```

**Step 2: Add bulk menu state**

After other state declarations:

```typescript
const [showBulkMenu, setShowBulkMenu] = useState(false);
```

**Step 3: Add b key handler**

In useInput, after the M key handler:

```typescript
if (input === 'b' && treeItems.length > 0) {
  setShowBulkMenu(true);
}
```

**Step 4: Add bulk menu close when other modes active**

At the start of useInput, add a guard:

```typescript
if (showBulkMenu) return;
```

**Step 5: Run TypeScript to verify no errors**

Run: `npm run build`
Expected: Build succeeds

**Step 6: Commit**

```bash
git add src/components/WorkItemList.tsx
git commit -m "feat(bulk): add bulk menu state and b key handler"
```

---

## Task 17: Render BulkMenu overlay

**Files:**
- Modify: `src/components/WorkItemList.tsx`

**Step 1: Add BulkMenu to render**

After the `{!isSearching && (` block opens and before the header, add:

```typescript
{showBulkMenu && (
  <BulkMenu
    itemCount={markedIds.size > 0 ? markedIds.size : 1}
    capabilities={capabilities}
    onSelect={(action) => {
      setShowBulkMenu(false);
      handleBulkAction(action);
    }}
    onCancel={() => setShowBulkMenu(false)}
  />
)}
```

**Step 2: Add placeholder handleBulkAction**

Before the return statement:

```typescript
const handleBulkAction = (action: BulkAction) => {
  // Will be implemented in next tasks
  setWarning(`Bulk action: ${action} (not yet implemented)`);
};
```

**Step 3: Run TypeScript to verify no errors**

Run: `npm run build`
Expected: Build succeeds

**Step 4: Manual test**

Run: `npm start`
Press `b`, verify menu appears. Press Esc, verify it closes.

**Step 5: Commit**

```bash
git add src/components/WorkItemList.tsx
git commit -m "feat(bulk): render BulkMenu overlay"
```

---

## Task 18: Add picker states for bulk actions

**Files:**
- Modify: `src/components/WorkItemList.tsx`

**Step 1: Import picker components**

Add to imports:

```typescript
import { PriorityPicker } from './PriorityPicker.js';
import { TypePicker } from './TypePicker.js';
import { StatusPicker } from './StatusPicker.js';
```

**Step 2: Add picker states**

After showBulkMenu state:

```typescript
const [showStatusPicker, setShowStatusPicker] = useState(false);
const [showTypePicker, setShowTypePicker] = useState(false);
const [showPriorityPicker, setShowPriorityPicker] = useState(false);
const [settingAssignee, setSettingAssignee] = useState(false);
const [assigneeInput, setAssigneeInput] = useState('');
const [settingLabels, setSettingLabels] = useState(false);
const [labelsInput, setLabelsInput] = useState('');
const [bulkTargetIds, setBulkTargetIds] = useState<string[]>([]);
```

**Step 3: Run TypeScript to verify no errors**

Run: `npm run build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/components/WorkItemList.tsx
git commit -m "feat(bulk): add picker states for bulk actions"
```

---

## Task 19: Implement handleBulkAction

**Files:**
- Modify: `src/components/WorkItemList.tsx`

**Step 1: Replace handleBulkAction placeholder**

```typescript
const handleBulkAction = (action: BulkAction) => {
  const targetIds = getTargetIds(markedIds, treeItems[cursor]?.item);
  if (targetIds.length === 0) return;
  setBulkTargetIds(targetIds);

  switch (action) {
    case 'status':
      setShowStatusPicker(true);
      break;
    case 'iteration':
      navigate('iteration-picker');
      break;
    case 'parent':
      setParentTargetIds(targetIds);
      setSettingParent(true);
      setParentInput('');
      break;
    case 'type':
      setShowTypePicker(true);
      break;
    case 'priority':
      setShowPriorityPicker(true);
      break;
    case 'assignee':
      setSettingAssignee(true);
      setAssigneeInput('');
      break;
    case 'labels':
      setSettingLabels(true);
      setLabelsInput('');
      break;
    case 'delete':
      setDeleteTargetIds(targetIds);
      setConfirmDelete(true);
      break;
  }
};
```

**Step 2: Run TypeScript to verify no errors**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/components/WorkItemList.tsx
git commit -m "feat(bulk): implement handleBulkAction dispatcher"
```

---

## Task 20: Add statuses to useBackendData

**Files:**
- Modify: `src/hooks/useBackendData.ts`

**Step 1: Check current hook and add statuses**

Read the hook to understand its structure, then add statuses to the returned data if not already present.

**Step 2: Run TypeScript to verify no errors**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/hooks/useBackendData.ts
git commit -m "feat(bulk): add statuses to useBackendData hook"
```

---

## Task 21: Render StatusPicker overlay

**Files:**
- Modify: `src/components/WorkItemList.tsx`

**Step 1: Get statuses from useBackendData**

Update the destructuring to include statuses:

```typescript
const {
  capabilities,
  types,
  statuses,
  currentIteration: iteration,
  items: allItems,
  loading,
  refresh: refreshData,
} = useBackendData(backend);
```

**Step 2: Add StatusPicker to render**

After the BulkMenu block:

```typescript
{showStatusPicker && (
  <StatusPicker
    statuses={statuses}
    onSelect={async (status) => {
      setShowStatusPicker(false);
      for (const id of bulkTargetIds) {
        await backend.cachedUpdateWorkItem(id, { status });
        await queueWrite('update', id);
      }
      setBulkTargetIds([]);
      refreshData();
    }}
    onCancel={() => {
      setShowStatusPicker(false);
      setBulkTargetIds([]);
    }}
  />
)}
```

**Step 3: Run TypeScript to verify no errors**

Run: `npm run build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/components/WorkItemList.tsx
git commit -m "feat(bulk): render StatusPicker overlay"
```

---

## Task 22: Render TypePicker overlay

**Files:**
- Modify: `src/components/WorkItemList.tsx`

**Step 1: Add TypePicker to render**

After the StatusPicker block:

```typescript
{showTypePicker && (
  <TypePicker
    types={types}
    onSelect={async (type) => {
      setShowTypePicker(false);
      for (const id of bulkTargetIds) {
        await backend.cachedUpdateWorkItem(id, { type });
        await queueWrite('update', id);
      }
      setBulkTargetIds([]);
      refreshData();
    }}
    onCancel={() => {
      setShowTypePicker(false);
      setBulkTargetIds([]);
    }}
  />
)}
```

**Step 2: Run TypeScript to verify no errors**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/components/WorkItemList.tsx
git commit -m "feat(bulk): render TypePicker overlay"
```

---

## Task 23: Render PriorityPicker overlay

**Files:**
- Modify: `src/components/WorkItemList.tsx`

**Step 1: Add PriorityPicker to render**

After the TypePicker block:

```typescript
{showPriorityPicker && (
  <PriorityPicker
    onSelect={async (priority) => {
      setShowPriorityPicker(false);
      for (const id of bulkTargetIds) {
        await backend.cachedUpdateWorkItem(id, { priority });
        await queueWrite('update', id);
      }
      setBulkTargetIds([]);
      refreshData();
    }}
    onCancel={() => {
      setShowPriorityPicker(false);
      setBulkTargetIds([]);
    }}
  />
)}
```

**Step 2: Run TypeScript to verify no errors**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/components/WorkItemList.tsx
git commit -m "feat(bulk): render PriorityPicker overlay"
```

---

## Task 24: Add assignee input UI

**Files:**
- Modify: `src/components/WorkItemList.tsx`

**Step 1: Add assignee input to render**

In the footer area, add handling for assignee input mode:

```typescript
{settingAssignee && (
  <Box>
    <Text color="cyan">
      Set assignee for {bulkTargetIds.length} item{bulkTargetIds.length > 1 ? 's' : ''}:{' '}
    </Text>
    <TextInput
      value={assigneeInput}
      onChange={setAssigneeInput}
      focus={true}
      onSubmit={async (value) => {
        const assignee = value.trim();
        for (const id of bulkTargetIds) {
          await backend.cachedUpdateWorkItem(id, { assignee });
          await queueWrite('update', id);
        }
        setSettingAssignee(false);
        setAssigneeInput('');
        setBulkTargetIds([]);
        refreshData();
      }}
    />
  </Box>
)}
```

**Step 2: Add escape handler for assignee**

In useInput, add guard:

```typescript
if (settingAssignee) {
  if (key.escape) {
    setSettingAssignee(false);
    setBulkTargetIds([]);
  }
  return;
}
```

**Step 3: Run TypeScript to verify no errors**

Run: `npm run build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/components/WorkItemList.tsx
git commit -m "feat(bulk): add assignee input UI"
```

---

## Task 25: Add labels input UI

**Files:**
- Modify: `src/components/WorkItemList.tsx`

**Step 1: Add labels input to render**

```typescript
{settingLabels && (
  <Box>
    <Text color="cyan">
      Set labels for {bulkTargetIds.length} item{bulkTargetIds.length > 1 ? 's' : ''} (comma-separated):{' '}
    </Text>
    <TextInput
      value={labelsInput}
      onChange={setLabelsInput}
      focus={true}
      onSubmit={async (value) => {
        const labels = value.split(',').map((l) => l.trim()).filter(Boolean);
        for (const id of bulkTargetIds) {
          await backend.cachedUpdateWorkItem(id, { labels });
          await queueWrite('update', id);
        }
        setSettingLabels(false);
        setLabelsInput('');
        setBulkTargetIds([]);
        refreshData();
      }}
    />
  </Box>
)}
```

**Step 2: Add escape handler for labels**

In useInput, add guard:

```typescript
if (settingLabels) {
  if (key.escape) {
    setSettingLabels(false);
    setBulkTargetIds([]);
  }
  return;
}
```

**Step 3: Run TypeScript to verify no errors**

Run: `npm run build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/components/WorkItemList.tsx
git commit -m "feat(bulk): add labels input UI"
```

---

## Task 26: Add P, a, l, t shortcut keys

**Files:**
- Modify: `src/components/WorkItemList.tsx`

**Step 1: Add shortcut handlers**

In useInput, after existing handlers:

```typescript
if (input === 'P' && capabilities.fields.priority && treeItems.length > 0) {
  const targetIds = getTargetIds(markedIds, treeItems[cursor]?.item);
  if (targetIds.length > 0) {
    setBulkTargetIds(targetIds);
    setShowPriorityPicker(true);
  }
}

if (input === 'a' && capabilities.fields.assignee && treeItems.length > 0) {
  const targetIds = getTargetIds(markedIds, treeItems[cursor]?.item);
  if (targetIds.length > 0) {
    setBulkTargetIds(targetIds);
    setSettingAssignee(true);
    setAssigneeInput('');
  }
}

if (input === 'l' && capabilities.fields.labels && treeItems.length > 0) {
  const targetIds = getTargetIds(markedIds, treeItems[cursor]?.item);
  if (targetIds.length > 0) {
    setBulkTargetIds(targetIds);
    setSettingLabels(true);
    setLabelsInput('');
  }
}

if (input === 't' && capabilities.customTypes && treeItems.length > 0) {
  const targetIds = getTargetIds(markedIds, treeItems[cursor]?.item);
  if (targetIds.length > 0) {
    setBulkTargetIds(targetIds);
    setShowTypePicker(true);
  }
}
```

**Step 2: Run TypeScript to verify no errors**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/components/WorkItemList.tsx
git commit -m "feat(bulk): add P, a, l, t shortcut keys"
```

---

## Task 27: Update HelpScreen with new shortcuts

**Files:**
- Modify: `src/components/HelpScreen.tsx`

**Step 1: Add new shortcuts to list view**

In the `case 'list':` section, add to the actions array:

```typescript
actions.push({ key: 'm', description: 'Toggle mark' });
actions.push({ key: 'M', description: 'Clear all marks' });
actions.push({ key: 'b', description: 'Bulk actions menu' });
if (capabilities.customTypes) {
  actions.push({ key: 't', description: 'Set type' });
}
if (capabilities.fields.priority) {
  actions.push({ key: 'P', description: 'Set priority' });
}
if (capabilities.fields.assignee) {
  actions.push({ key: 'a', description: 'Set assignee' });
}
if (capabilities.fields.labels) {
  actions.push({ key: 'l', description: 'Set labels' });
}
```

**Step 2: Run TypeScript to verify no errors**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/components/HelpScreen.tsx
git commit -m "feat(bulk): update HelpScreen with new shortcuts"
```

---

## Task 28: Add tests for getTargetIds

**Files:**
- Create: `src/components/WorkItemList.test.ts`

**Step 1: Export getTargetIds for testing**

In WorkItemList.tsx, export the function:

```typescript
export function getTargetIds(...)
```

**Step 2: Create test file**

```typescript
import { describe, it, expect } from 'vitest';
import { getTargetIds } from './WorkItemList.js';

describe('getTargetIds', () => {
  it('returns marked IDs when marks present', () => {
    const marked = new Set(['1', '2', '3']);
    const cursor = { id: '5' };
    expect(getTargetIds(marked, cursor)).toEqual(['1', '2', '3']);
  });

  it('returns cursor ID when no marks', () => {
    const marked = new Set<string>();
    const cursor = { id: '5' };
    expect(getTargetIds(marked, cursor)).toEqual(['5']);
  });

  it('returns empty array when no marks and no cursor', () => {
    const marked = new Set<string>();
    expect(getTargetIds(marked, undefined)).toEqual([]);
  });

  it('ignores cursor item when marks present', () => {
    const marked = new Set(['1', '2']);
    const cursor = { id: '5' };
    const result = getTargetIds(marked, cursor);
    expect(result).not.toContain('5');
  });
});
```

**Step 3: Run tests**

Run: `npx vitest run src/components/WorkItemList.test.ts`
Expected: All tests pass

**Step 4: Commit**

```bash
git add src/components/WorkItemList.tsx src/components/WorkItemList.test.ts
git commit -m "test(bulk): add tests for getTargetIds"
```

---

## Task 29: Run full test suite

**Files:** None (verification only)

**Step 1: Run all tests**

Run: `npm test`
Expected: All tests pass

**Step 2: Run linter**

Run: `npm run lint`
Expected: No errors

**Step 3: Run formatter check**

Run: `npm run format:check`
Expected: All files formatted

**Step 4: Commit any fixes if needed**

---

## Task 30: Manual integration test

**Files:** None (verification only)

**Step 1: Start the app**

Run: `npm start`

**Step 2: Test marking**

- Navigate to an item, press `m` to mark (verify background changes)
- Navigate to another item, press `m` (verify 2 marked shown in header)
- Press `M` to clear all (verify marks gone)

**Step 3: Test bulk delete**

- Mark 2 items with `m`
- Press `d`
- Verify "Delete 2 items?" confirmation
- Press `n` to cancel
- Verify items still exist

**Step 4: Test bulk menu**

- Mark 2 items
- Press `b`
- Verify menu shows "Bulk Actions (2 items)"
- Press Esc to close

**Step 5: Test status picker from menu**

- Press `b`, then select "Set status..."
- Select a status
- Verify both items updated

**Step 6: Test shortcuts**

- Mark items
- Press `P` to set priority
- Verify picker appears and works

---

## Task 31: Final commit and summary

**Step 1: Ensure all changes committed**

Run: `git status`
Expected: Working tree clean

**Step 2: Review commit history**

Run: `git log --oneline -20`
Verify all bulk operations commits are present.
