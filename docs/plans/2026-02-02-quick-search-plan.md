# Quick Search Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `/`-triggered fuzzy search overlay to the list view that lets users jump directly to any work item's edit form.

**Architecture:** New `SearchOverlay` component rendered inside `WorkItemList` when a local `isSearching` state is true. A pure `fuzzyMatch` utility scores items by title, ID, and labels. Results are grouped by current vs. other iterations.

**Tech Stack:** React 19 + Ink 6 (existing), Vitest for tests, no new dependencies.

---

### Task 1: Fuzzy Match Utility — Tests

**Files:**
- Create: `src/components/fuzzyMatch.test.ts`

**Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import { fuzzyMatch, type FuzzyResult } from './fuzzyMatch.js';
import type { WorkItem } from '../types.js';

function makeItem(overrides: Partial<WorkItem> & { id: string }): WorkItem {
  return {
    title: `Item ${overrides.id}`,
    type: 'task',
    status: 'open',
    iteration: 'sprint-1',
    priority: 'medium',
    assignee: '',
    labels: [],
    created: '',
    updated: '',
    description: '',
    comments: [],
    parent: null,
    dependsOn: [],
    ...overrides,
  };
}

describe('fuzzyMatch', () => {
  it('returns empty array for empty query', () => {
    const items = [makeItem({ id: '1', title: 'Auth bug' })];
    expect(fuzzyMatch(items, '')).toEqual([]);
  });

  it('matches by title substring', () => {
    const items = [
      makeItem({ id: '1', title: 'Auth bug on login' }),
      makeItem({ id: '2', title: 'Dashboard redesign' }),
    ];
    const results = fuzzyMatch(items, 'auth');
    expect(results.length).toBe(1);
    expect(results[0]!.item.id).toBe('1');
  });

  it('matches by ID', () => {
    const items = [
      makeItem({ id: '12', title: 'Something' }),
      makeItem({ id: '34', title: 'Other' }),
    ];
    const results = fuzzyMatch(items, '12');
    expect(results.length).toBe(1);
    expect(results[0]!.item.id).toBe('12');
  });

  it('matches by label', () => {
    const items = [
      makeItem({ id: '1', title: 'Foo', labels: ['critical', 'backend'] }),
      makeItem({ id: '2', title: 'Bar', labels: ['frontend'] }),
    ];
    const results = fuzzyMatch(items, 'backend');
    expect(results.length).toBe(1);
    expect(results[0]!.item.id).toBe('1');
  });

  it('is case insensitive', () => {
    const items = [makeItem({ id: '1', title: 'Auth Bug' })];
    const results = fuzzyMatch(items, 'auth bug');
    expect(results.length).toBe(1);
  });

  it('ranks exact prefix matches higher', () => {
    const items = [
      makeItem({ id: '1', title: 'Authentication service' }),
      makeItem({ id: '2', title: 'OAuth integration' }),
    ];
    const results = fuzzyMatch(items, 'auth');
    expect(results[0]!.item.id).toBe('1');
  });

  it('returns multiple matches sorted by score', () => {
    const items = [
      makeItem({ id: '1', title: 'Fix auth token' }),
      makeItem({ id: '2', title: 'Auth bug on login' }),
      makeItem({ id: '3', title: 'Dashboard' }),
    ];
    const results = fuzzyMatch(items, 'auth');
    expect(results.length).toBe(2);
    // "Auth bug" starts with auth, so should rank higher
    expect(results[0]!.item.id).toBe('2');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/fuzzyMatch.test.ts`
Expected: FAIL — cannot find `./fuzzyMatch.js`

---

### Task 2: Fuzzy Match Utility — Implementation

**Files:**
- Create: `src/components/fuzzyMatch.ts`

**Step 1: Implement the fuzzy match function**

```typescript
import type { WorkItem } from '../types.js';

export interface FuzzyResult {
  item: WorkItem;
  score: number;
}

function scoreField(field: string, query: string): number {
  const lower = field.toLowerCase();
  const q = query.toLowerCase();

  if (lower === q) return 100; // exact match
  if (lower.startsWith(q)) return 80; // prefix match

  // Word-boundary match (query appears at start of a word)
  const words = lower.split(/[\s\-_]+/);
  for (const word of words) {
    if (word.startsWith(q)) return 60;
  }

  // Substring match
  if (lower.includes(q)) return 40;

  return 0;
}

export function fuzzyMatch(items: WorkItem[], query: string): FuzzyResult[] {
  if (query.trim() === '') return [];

  const q = query.trim().toLowerCase();
  const results: FuzzyResult[] = [];

  for (const item of items) {
    const titleScore = scoreField(item.title, q);
    const idScore = scoreField(item.id, q);
    const labelScore = Math.max(
      0,
      ...item.labels.map((l) => scoreField(l, q)),
    );
    const bestScore = Math.max(titleScore, idScore, labelScore);

    if (bestScore > 0) {
      results.push({ item, score: bestScore });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}
```

**Step 2: Run tests to verify they pass**

Run: `npx vitest run src/components/fuzzyMatch.test.ts`
Expected: PASS (all 7 tests)

**Step 3: Commit**

```bash
git add src/components/fuzzyMatch.ts src/components/fuzzyMatch.test.ts
git commit -m "feat: add fuzzyMatch utility for quick search"
```

---

### Task 3: SearchOverlay Component — Tests

**Files:**
- Create: `src/components/SearchOverlay.test.ts`

**Step 1: Write the failing tests**

Test the grouping and result-limiting logic as a pure function extracted from the component. Since `ink-testing-library` is not available, test the data transformation logic only.

```typescript
import { describe, it, expect } from 'vitest';
import { groupResults } from './SearchOverlay.js';
import type { WorkItem } from '../types.js';
import type { FuzzyResult } from './fuzzyMatch.js';

function makeItem(overrides: Partial<WorkItem> & { id: string }): WorkItem {
  return {
    title: `Item ${overrides.id}`,
    type: 'task',
    status: 'open',
    iteration: 'sprint-1',
    priority: 'medium',
    assignee: '',
    labels: [],
    created: '',
    updated: '',
    description: '',
    comments: [],
    parent: null,
    dependsOn: [],
    ...overrides,
  };
}

describe('groupResults', () => {
  it('puts current iteration items first', () => {
    const results: FuzzyResult[] = [
      { item: makeItem({ id: '1', iteration: 'sprint-2' }), score: 50 },
      { item: makeItem({ id: '2', iteration: 'sprint-1' }), score: 50 },
    ];
    const grouped = groupResults(results, 'sprint-1');
    expect(grouped[0]!.item.id).toBe('2');
    expect(grouped[1]!.item.id).toBe('1');
  });

  it('preserves score order within groups', () => {
    const results: FuzzyResult[] = [
      { item: makeItem({ id: '1', iteration: 'sprint-1' }), score: 40 },
      { item: makeItem({ id: '2', iteration: 'sprint-1' }), score: 80 },
    ];
    const grouped = groupResults(results, 'sprint-1');
    expect(grouped[0]!.item.id).toBe('2');
    expect(grouped[1]!.item.id).toBe('1');
  });

  it('returns flat list when currentIteration is null', () => {
    const results: FuzzyResult[] = [
      { item: makeItem({ id: '1', iteration: 'sprint-1' }), score: 80 },
      { item: makeItem({ id: '2', iteration: 'sprint-2' }), score: 40 },
    ];
    const grouped = groupResults(results, null);
    expect(grouped[0]!.item.id).toBe('1');
    expect(grouped[1]!.item.id).toBe('2');
  });

  it('limits results to max count', () => {
    const results: FuzzyResult[] = Array.from({ length: 20 }, (_, i) => ({
      item: makeItem({ id: String(i), iteration: 'sprint-1' }),
      score: 50,
    }));
    const grouped = groupResults(results, 'sprint-1', 10);
    expect(grouped.length).toBe(10);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/SearchOverlay.test.ts`
Expected: FAIL — cannot find `./SearchOverlay.js`

---

### Task 4: SearchOverlay Component — Implementation

**Files:**
- Create: `src/components/SearchOverlay.tsx`

**Step 1: Implement the SearchOverlay component**

```tsx
import { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { fuzzyMatch, type FuzzyResult } from './fuzzyMatch.js';
import type { WorkItem } from '../types.js';

export interface SearchOverlayProps {
  items: WorkItem[];
  currentIteration: string | null;
  onSelect: (item: WorkItem) => void;
  onCancel: () => void;
}

export function groupResults(
  results: FuzzyResult[],
  currentIteration: string | null,
  maxResults: number = 10,
): FuzzyResult[] {
  if (!currentIteration) {
    return results.slice(0, maxResults);
  }
  const current = results.filter(
    (r) => r.item.iteration === currentIteration,
  );
  const other = results.filter(
    (r) => r.item.iteration !== currentIteration,
  );
  return [...current, ...other].slice(0, maxResults);
}

export function SearchOverlay({
  items,
  currentIteration,
  onSelect,
  onCancel,
}: SearchOverlayProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const results = useMemo(() => {
    const matched = fuzzyMatch(items, query);
    return groupResults(matched, currentIteration);
  }, [items, query, currentIteration]);

  // Find the boundary between current and other iteration results
  const currentIterationCount = useMemo(() => {
    if (!currentIteration) return 0;
    return results.filter((r) => r.item.iteration === currentIteration).length;
  }, [results, currentIteration]);

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
    }
    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(results.length - 1, i + 1));
    }
    if (key.return && results.length > 0) {
      const selected = results[selectedIndex];
      if (selected) {
        onSelect(selected.item);
      }
    }
  });

  // Reset selection when query changes
  const handleQueryChange = (value: string) => {
    setQuery(value);
    setSelectedIndex(0);
  };

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
    >
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Search{' '}
        </Text>
        <TextInput
          value={query}
          onChange={handleQueryChange}
          focus={true}
          placeholder="Type to search..."
        />
      </Box>

      {query.trim() === '' && (
        <Text dimColor>Type to search by title, ID, or label...</Text>
      )}

      {query.trim() !== '' && results.length === 0 && (
        <Text dimColor>No items found</Text>
      )}

      {results.map((result, index) => {
        const showCurrentHeader =
          currentIteration && currentIterationCount > 0 && index === 0;
        const showOtherHeader =
          currentIteration &&
          currentIterationCount > 0 &&
          index === currentIterationCount;

        return (
          <Box key={result.item.id} flexDirection="column">
            {showCurrentHeader && (
              <Text dimColor>Current iteration:</Text>
            )}
            {showOtherHeader && (
              <Box marginTop={1}>
                <Text dimColor>Other iterations:</Text>
              </Box>
            )}
            <Box>
              <Text
                color={index === selectedIndex ? 'cyan' : undefined}
                bold={index === selectedIndex}
              >
                {index === selectedIndex ? '● ' : '  '}
              </Text>
              <Box width={8}>
                <Text
                  color={index === selectedIndex ? 'cyan' : 'yellow'}
                >
                  #{result.item.id}
                </Text>
              </Box>
              <Text
                color={index === selectedIndex ? 'cyan' : undefined}
              >
                {result.item.title}
              </Text>
              {result.item.labels.length > 0 && (
                <Text dimColor>
                  {' '}
                  [{result.item.labels.join(', ')}]
                </Text>
              )}
              <Text dimColor> ({result.item.type})</Text>
            </Box>
          </Box>
        );
      })}

      <Box marginTop={1}>
        <Text dimColor>↑↓ navigate  enter select  esc cancel</Text>
      </Box>
    </Box>
  );
}
```

**Step 2: Run tests to verify they pass**

Run: `npx vitest run src/components/SearchOverlay.test.ts`
Expected: PASS (all 4 tests)

**Step 3: Run lint and format**

Run: `npm run format -- --write src/components/SearchOverlay.tsx src/components/fuzzyMatch.ts && npm run lint`
Expected: No errors

**Step 4: Commit**

```bash
git add src/components/SearchOverlay.tsx src/components/SearchOverlay.test.ts
git commit -m "feat: add SearchOverlay component with iteration grouping"
```

---

### Task 5: Wire SearchOverlay into WorkItemList

**Files:**
- Modify: `src/components/WorkItemList.tsx:1-395`

**Step 1: Add search state and load all items**

At the top of `WorkItemList`, add a new state and a second `useBackendData` call (or a direct `listWorkItems()` call) for all items across all iterations:

In `src/components/WorkItemList.tsx`, add import at line 1-17:

```typescript
import { SearchOverlay } from './SearchOverlay.js';
```

After the existing state declarations (around line 34), add:

```typescript
const [isSearching, setIsSearching] = useState(false);
const [allSearchItems, setAllSearchItems] = useState<WorkItem[]>([]);
```

**Step 2: Load all items when search opens**

Add a useEffect that fetches all items (no iteration filter) when search activates:

```typescript
useEffect(() => {
  if (!isSearching) return;
  let cancelled = false;
  void backend.listWorkItems().then((items) => {
    if (!cancelled) setAllSearchItems(items);
  });
  return () => { cancelled = true; };
}, [isSearching, backend]);
```

**Step 3: Add `/` key handler**

In the `useInput` callback (around line 137), add before the `if (input === '?')` block:

```typescript
if (input === '/') {
  setIsSearching(true);
  return;
}
```

Also, add an early return at the top of useInput when searching is active (right after the `settingParent` check at line 138):

```typescript
if (isSearching) return;
```

**Step 4: Add search handlers**

After the `useInput` block, add handler functions:

```typescript
const handleSearchSelect = (item: WorkItem) => {
  setIsSearching(false);
  selectWorkItem(item.id);
  navigate('form');
};

const handleSearchCancel = () => {
  setIsSearching(false);
};
```

**Step 5: Render the SearchOverlay**

In the JSX return, add the overlay conditionally. Insert right after the opening `<Box flexDirection="column">` (line 302):

```tsx
{isSearching && (
  <SearchOverlay
    items={allSearchItems}
    currentIteration={iteration}
    onSelect={handleSearchSelect}
    onCancel={handleSearchCancel}
  />
)}
```

Wrap the existing list content so it's hidden during search. After the SearchOverlay block:

```tsx
{!isSearching && (
  <>
    {/* ...existing JSX from <Box marginBottom={1}> through end... */}
  </>
)}
```

**Step 6: Run all tests**

Run: `npm test`
Expected: All tests pass

**Step 7: Run lint and format**

Run: `npm run format -- --write src/components/WorkItemList.tsx && npm run lint`
Expected: No errors

**Step 8: Commit**

```bash
git add src/components/WorkItemList.tsx
git commit -m "feat: wire SearchOverlay into WorkItemList with / keybinding"
```

---

### Task 6: Add `/` to Help Screen

**Files:**
- Modify: `src/components/HelpScreen.tsx:42-48`

**Step 1: Add the search shortcut to the actions list**

In the `getShortcuts` function, `case 'list'` block, add to the `actions` array (around line 48, after the `'o'` shortcut):

```typescript
actions.push({ key: '/', description: 'Quick search' });
```

**Step 2: Update HelpScreen test**

In `src/components/HelpScreen.test.tsx`, update the first test (`'returns list shortcuts with all capabilities'`) to also check for `/`:

Add this assertion after the existing ones:

```typescript
expect(allKeys).toContain('/');
```

**Step 3: Run tests**

Run: `npx vitest run src/components/HelpScreen.test.tsx`
Expected: PASS

**Step 4: Commit**

```bash
git add src/components/HelpScreen.tsx src/components/HelpScreen.test.tsx
git commit -m "feat: add quick search shortcut to help screen"
```

---

### Task 7: Update help text in WorkItemList

**Files:**
- Modify: `src/components/WorkItemList.tsx:282`

**Step 1: Add `/` to the help bar**

Change line 282 from:

```typescript
const helpText = '↑↓ navigate  enter edit  c create  ? help';
```

to:

```typescript
const helpText = '↑↓ navigate  enter edit  c create  / search  ? help';
```

**Step 2: Build and verify**

Run: `npm run build`
Expected: No errors

**Step 3: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 4: Commit**

```bash
git add src/components/WorkItemList.tsx
git commit -m "feat: add search hint to list view help bar"
```

---

### Task 8: Manual smoke test

**Step 1: Run the app**

Run: `npm start`

**Step 2: Verify**

- Press `/` — search overlay should appear
- Type a query — results should appear, grouped by iteration
- Arrow keys — should navigate results
- Enter — should open the selected item's edit form
- Esc — should dismiss search and return to list
- Press `?` — help screen should show `/` shortcut

**Step 3: Final commit (if any fixes needed)**

Only if fixes are needed from smoke testing.
