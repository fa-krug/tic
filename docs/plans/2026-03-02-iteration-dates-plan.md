# Iteration Dates Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add optional start and end dates to iterations so users can see time boundaries of each sprint.

**Architecture:** Introduce an `Iteration` interface (`name`, `startDate`, `endDate`) to replace `string` throughout the iteration pipeline. Add `start_date`/`end_date` columns to the SQLite `iterations` table via migration. Update all backends, stores, CLI, MCP, and UI components to use structured iteration objects. Auto-detect current iteration from date ranges.

**Tech Stack:** TypeScript, Drizzle ORM (SQLite migration), Ink/React (terminal UI), Vitest

---

### Task 1: Add `Iteration` type and update Backend interface

**Files:**
- Modify: `src/types.ts`
- Modify: `src/backends/types.ts:50-55` (Backend interface)
- Modify: `src/backends/types.ts:120-126` (BaseBackend abstract methods)

**Step 1: Write the failing test**

Create `src/iteration-utils.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type { Iteration } from './types.js';
import { findCurrentIteration, formatIterationDates, getIterationStatus } from './iteration-utils.js';

describe('findCurrentIteration', () => {
  it('returns iteration whose date range contains today', () => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const iterations: Iteration[] = [
      { name: 'past', startDate: '2020-01-01', endDate: '2020-01-31' },
      {
        name: 'current',
        startDate: yesterday.toISOString().split('T')[0]!,
        endDate: tomorrow.toISOString().split('T')[0]!,
      },
      { name: 'future', startDate: '2099-01-01', endDate: '2099-01-31' },
    ];

    expect(findCurrentIteration(iterations)).toBe('current');
  });

  it('returns null when no iteration matches today', () => {
    const iterations: Iteration[] = [
      { name: 'past', startDate: '2020-01-01', endDate: '2020-01-31' },
    ];
    expect(findCurrentIteration(iterations)).toBeNull();
  });

  it('returns null for iterations with no dates', () => {
    const iterations: Iteration[] = [
      { name: 'no-dates', startDate: null, endDate: null },
    ];
    expect(findCurrentIteration(iterations)).toBeNull();
  });
});

describe('formatIterationDates', () => {
  it('formats both dates as short range', () => {
    expect(formatIterationDates('2026-01-06', '2026-01-20')).toBe('Jan 6 – Jan 20');
  });

  it('formats end date only as due date', () => {
    expect(formatIterationDates(null, '2026-01-20')).toBe('due Jan 20');
  });

  it('formats start date only', () => {
    expect(formatIterationDates('2026-01-06', null)).toBe('from Jan 6');
  });

  it('returns null when no dates', () => {
    expect(formatIterationDates(null, null)).toBeNull();
  });
});

describe('getIterationStatus', () => {
  it('returns active when today is in range', () => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    expect(getIterationStatus(
      yesterday.toISOString().split('T')[0]!,
      tomorrow.toISOString().split('T')[0]!,
    )).toBe('active');
  });

  it('returns past when end date has passed', () => {
    expect(getIterationStatus('2020-01-01', '2020-01-31')).toBe('past');
  });

  it('returns upcoming when start date is future', () => {
    expect(getIterationStatus('2099-01-01', '2099-01-31')).toBe('upcoming');
  });

  it('returns null when no dates', () => {
    expect(getIterationStatus(null, null)).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/iteration-utils.test.ts`
Expected: FAIL — modules not found

**Step 3: Add `Iteration` type to `src/types.ts`**

After the existing `NewPullRequest` interface (end of file), add:

```typescript
export interface Iteration {
  name: string;
  startDate: string | null;
  endDate: string | null;
}
```

**Step 4: Create `src/iteration-utils.ts`**

```typescript
import type { Iteration } from './types.js';

/**
 * Find the iteration whose date range contains today.
 * Returns the iteration name, or null if none match.
 */
export function findCurrentIteration(iterations: Iteration[]): string | null {
  const today = new Date().toISOString().split('T')[0]!;
  for (const it of iterations) {
    if (it.startDate && it.endDate && it.startDate <= today && today <= it.endDate) {
      return it.name;
    }
  }
  return null;
}

/**
 * Format iteration dates for display.
 * Returns e.g. "Jan 6 – Jan 20", "due Jan 20", "from Jan 6", or null.
 */
export function formatIterationDates(
  startDate: string | null,
  endDate: string | null,
): string | null {
  if (!startDate && !endDate) return null;

  const fmt = (iso: string): string => {
    const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
    const date = new Date(y, m - 1, d);
    const month = date.toLocaleString('en-US', { month: 'short' });
    return `${month} ${date.getDate()}`;
  };

  if (startDate && endDate) return `${fmt(startDate)} – ${fmt(endDate)}`;
  if (endDate) return `due ${fmt(endDate)}`;
  return `from ${fmt(startDate!)}`;
}

/**
 * Get the temporal status of an iteration relative to today.
 */
export function getIterationStatus(
  startDate: string | null,
  endDate: string | null,
): 'active' | 'past' | 'upcoming' | null {
  if (!startDate && !endDate) return null;
  const today = new Date().toISOString().split('T')[0]!;
  if (endDate && endDate < today) return 'past';
  if (startDate && startDate > today) return 'upcoming';
  return 'active';
}
```

**Step 5: Update Backend interface in `src/backends/types.ts`**

Add import at top:
```typescript
import type { Iteration } from '../types.js';
```

Change `Backend` interface (line ~50):
```typescript
// Old:
getIterations(): Promise<string[]>;
// New:
getIterations(): Promise<Iteration[]>;
```

Change `BaseBackend` abstract method (line ~120):
```typescript
// Old:
abstract getIterations(): Promise<string[]>;
// New:
abstract getIterations(): Promise<Iteration[]>;
```

**Step 6: Run tests to verify iteration-utils tests pass**

Run: `npx vitest run src/iteration-utils.test.ts`
Expected: PASS (all 7 tests)

**Step 7: Commit**

```bash
git add src/types.ts src/iteration-utils.ts src/iteration-utils.test.ts src/backends/types.ts
git commit -m "feat: add Iteration type and utility functions"
```

---

### Task 2: Schema migration — add date columns to iterations table

**Files:**
- Modify: `src/storage/schema.ts:157-161`
- Create: new migration in `drizzle/`
- Modify: `src/storage/db.ts` (if migration runner needs update)

**Step 1: Update schema definition**

In `src/storage/schema.ts`, change the `iterations` table (lines 157-161):

```typescript
// Old:
export const iterations = sqliteTable('iterations', {
  name: text('name').primaryKey(),
  sortOrder: integer('sort_order').notNull().default(0),
});

// New:
export const iterations = sqliteTable('iterations', {
  name: text('name').primaryKey(),
  sortOrder: integer('sort_order').notNull().default(0),
  startDate: text('start_date'),
  endDate: text('end_date'),
});
```

**Step 2: Generate migration**

Run: `npx drizzle-kit generate`

This creates a new migration file in `drizzle/`. Verify it adds two nullable TEXT columns.

**Step 3: Build and verify migration applies cleanly**

Run: `npm run build && npm test`
Expected: Build succeeds, existing tests pass (new columns are nullable so backward-compatible)

**Step 4: Commit**

```bash
git add src/storage/schema.ts drizzle/
git commit -m "feat: add start_date and end_date columns to iterations table"
```

---

### Task 3: Update Storage backend to return `Iteration[]`

**Files:**
- Modify: `src/storage/index.ts:235-243` (`getIterations`)
- Modify: `src/storage/config.ts:7-38,99-103,127,286-292` (Config type, readConfig, insertConfigTx)
- Modify: `src/storage/config.test.ts`

**Step 1: Write failing tests**

Add to `src/storage/config.test.ts`:

```typescript
it('reads and writes iterations with dates', () => {
  const iterations = [
    { name: 'sprint-1', startDate: '2026-01-06', endDate: '2026-01-20' },
    { name: 'sprint-2', startDate: '2026-01-20', endDate: '2026-02-03' },
    { name: 'backlog', startDate: null, endDate: null },
  ];
  updateConfig(db, { iterations });

  const config = readConfig(db);
  expect(config.iterations).toEqual(iterations);
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/storage/config.test.ts`
Expected: FAIL — `Config.iterations` is still `string[]`

**Step 3: Update Config type in `src/storage/config.ts`**

Add import:
```typescript
import type { Iteration } from '../types.js';
```

Change Config interface:
```typescript
// Old (line 12):
iterations: string[];
// New:
iterations: Iteration[];
```

Change defaultConfig:
```typescript
// Old (line 45):
iterations: ['default'],
// New:
iterations: [{ name: 'default', startDate: null, endDate: null }],
```

**Step 4: Update `readConfig` in `src/storage/config.ts`**

Change line ~127:
```typescript
// Old:
iterations: iterationRows.map((r) => r.name),
// New:
iterations: iterationRows.map((r) => ({
  name: r.name,
  startDate: r.startDate ?? null,
  endDate: r.endDate ?? null,
})),
```

**Step 5: Update `insertConfigTx` in `src/storage/config.ts`**

Change lines ~286-292:
```typescript
// Old:
tx.delete(schema.iterations).run();
for (let i = 0; i < config.iterations.length; i++) {
  tx.insert(schema.iterations)
    .values({ name: config.iterations[i]!, sortOrder: i })
    .run();
}

// New:
tx.delete(schema.iterations).run();
for (let i = 0; i < config.iterations.length; i++) {
  const it = config.iterations[i]!;
  tx.insert(schema.iterations)
    .values({
      name: it.name,
      sortOrder: i,
      startDate: it.startDate,
      endDate: it.endDate,
    })
    .run();
}
```

**Step 6: Update Storage.getIterations() in `src/storage/index.ts`**

Change lines 235-243:
```typescript
// Old:
async getIterations(): Promise<string[]> {
  const rows = this.db
    .select()
    .from(schema.iterations)
    .orderBy(schema.iterations.sortOrder)
    .all();
  return rows.map((r) => r.name);
}

// New:
async getIterations(): Promise<Iteration[]> {
  const rows = this.db
    .select()
    .from(schema.iterations)
    .orderBy(schema.iterations.sortOrder)
    .all();
  return rows.map((r) => ({
    name: r.name,
    startDate: r.startDate ?? null,
    endDate: r.endDate ?? null,
  }));
}
```

Add import at top of `src/storage/index.ts`:
```typescript
import type { Iteration } from '../types.js';
```

**Step 7: Fix existing tests that use `string[]` for iterations**

In `src/storage/config.test.ts`, update the existing test at lines 72-78:
```typescript
// Old:
const customIterations = ['sprint-1', 'sprint-2', 'sprint-3'];
// New:
const customIterations = [
  { name: 'sprint-1', startDate: null, endDate: null },
  { name: 'sprint-2', startDate: null, endDate: null },
  { name: 'sprint-3', startDate: null, endDate: null },
];
```

Update the default config assertion (line ~33):
```typescript
// Old:
expect(config.iterations).toEqual(['default']);
// New:
expect(config.iterations).toEqual([{ name: 'default', startDate: null, endDate: null }]);
```

Search for and fix any other test files that pass `iterations: string[]` to config or compare iterations as strings. Key files to check:
- `src/storage/index.test.ts`
- `src/stores/configStore.test.ts`
- Any test that calls `updateConfig` or `readConfig` with iterations

**Step 8: Run tests**

Run: `npx vitest run src/storage/config.test.ts`
Expected: PASS

**Step 9: Commit**

```bash
git add src/storage/config.ts src/storage/index.ts src/storage/config.test.ts
git commit -m "feat: store iteration dates in config and Storage backend"
```

---

### Task 4: Update backendDataStore to hold `Iteration[]`

**Files:**
- Modify: `src/stores/backendDataStore.ts:83,216,280-310`

**Step 1: Update store state type and initial value**

In `src/stores/backendDataStore.ts`, add import:
```typescript
import type { Iteration } from '../types.js';
```

Change state shape (line ~83):
```typescript
// Old:
iterations: string[];
// New:
iterations: Iteration[];
```

Change initial state (line ~216):
```typescript
// Old:
iterations: [],
// New:
iterations: [] as Iteration[],
```

**Step 2: Update `refresh()` to use auto-detect**

Add import:
```typescript
import { findCurrentIteration } from '../iteration-utils.js';
```

In `refresh()` (lines ~280-310), after fetching iterations, auto-detect current:
```typescript
// After the Promise.all that fetches iterations:
const autoDetected = findCurrentIteration(iterations);
const iter = autoDetected ?? await currentBackend.getCurrentIteration();
```

Note: The `iter` variable is currently computed *before* the `Promise.all`. Restructure so iterations are fetched first, then current is determined:

```typescript
const [statuses, iterations, types] = await Promise.all([
  currentBackend.getStatuses(),
  currentBackend.getIterations(),
  currentBackend.getWorkItemTypes(),
]);

const autoDetected = findCurrentIteration(iterations);
const iter = autoDetected ?? await currentBackend.getCurrentIteration();
const items = await currentBackend.listWorkItems(iter);
```

**Step 3: Run the full test suite to check for type errors**

Run: `npm run build`
Expected: Type errors in files that consume `iterations` as `string[]` (this is expected — we'll fix them in subsequent tasks)

**Step 4: Commit**

```bash
git add src/stores/backendDataStore.ts
git commit -m "feat: store Iteration objects in backendDataStore with auto-detect"
```

---

### Task 5: Update remote backends to return `Iteration[]`

**Files:**
- Modify: `src/backends/github/index.ts:253-256`
- Modify: `src/backends/gitlab/index.ts:363-366`
- Modify: `src/backends/jira/index.ts:151-155` and `src/backends/jira/mappers.ts:54-58`
- Modify: `src/backends/ado/index.ts:168-176`

**Step 1: Update GitHub backend**

In `src/backends/github/index.ts`, add import:
```typescript
import type { Iteration } from '../../types.js';
```

Change `getIterations()` (lines 253-256):
```typescript
// Old:
async getIterations(): Promise<string[]> {
  const milestones = await this.fetchMilestones();
  return milestones.map((m) => m.title);
}
// New:
async getIterations(): Promise<Iteration[]> {
  const milestones = await this.fetchMilestones();
  return milestones.map((m) => ({
    name: m.title,
    startDate: null,
    endDate: m.due_on ? m.due_on.split('T')[0]! : null,
  }));
}
```

**Step 2: Update GitLab backend**

In `src/backends/gitlab/index.ts`, add import:
```typescript
import type { Iteration } from '../../types.js';
```

Change `getIterations()` (lines 363-366):
```typescript
// Old:
async getIterations(): Promise<string[]> {
  const ms = await this.fetchMilestones();
  return ms.map((m) => m.title);
}
// New:
async getIterations(): Promise<Iteration[]> {
  const ms = await this.fetchMilestones();
  return ms.map((m) => ({
    name: m.title,
    startDate: m.startDate || null,
    endDate: m.dueDate || null,
  }));
}
```

**Step 3: Update Jira backend**

First, update `JiraSprint` in `src/backends/jira/mappers.ts` to include date fields:
```typescript
// Old:
export interface JiraSprint {
  id: number;
  name: string;
  state: string;
}
// New:
export interface JiraSprint {
  id: number;
  name: string;
  state: string;
  startDate?: string;
  endDate?: string;
}
```

In `src/backends/jira/index.ts`, add import:
```typescript
import type { Iteration } from '../../types.js';
```

Change `getIterations()` (lines 151-155):
```typescript
// Old:
async getIterations(): Promise<string[]> {
  if (!this.config.boardId) return [];
  const sprints = await this.fetchSprints();
  return sprints.map((s) => s.name);
}
// New:
async getIterations(): Promise<Iteration[]> {
  if (!this.config.boardId) return [];
  const sprints = await this.fetchSprints();
  return sprints.map((s) => ({
    name: s.name,
    startDate: s.startDate?.split('T')[0] ?? null,
    endDate: s.endDate?.split('T')[0] ?? null,
  }));
}
```

**Step 4: Update ADO backend**

In `src/backends/ado/index.ts`, add import:
```typescript
import type { Iteration } from '../../types.js';
```

Update the REST call type annotation in `getIterations()` and return `Iteration[]`:
```typescript
// Old:
async getIterations(): Promise<string[]> {
  const result = await this.api.rest<{
    value: { path: string }[];
  }>(
    'GET',
    `/${encodeURIComponent(this.project)}/${encodeURIComponent(this.project + ' Team')}/_apis/work/teamsettings/iterations`,
  );
  return result.value.map((i) => i.path);
}
// New:
async getIterations(): Promise<Iteration[]> {
  const result = await this.api.rest<{
    value: {
      path: string;
      attributes?: { startDate?: string; finishDate?: string };
    }[];
  }>(
    'GET',
    `/${encodeURIComponent(this.project)}/${encodeURIComponent(this.project + ' Team')}/_apis/work/teamsettings/iterations`,
  );
  return result.value.map((i) => ({
    name: i.path,
    startDate: i.attributes?.startDate?.split('T')[0] ?? null,
    endDate: i.attributes?.finishDate?.split('T')[0] ?? null,
  }));
}
```

**Step 5: Build to verify all backends compile**

Run: `npm run build`
Expected: May still have errors in consumers (CLI, UI) — those are fixed in next tasks

**Step 6: Commit**

```bash
git add src/backends/github/index.ts src/backends/gitlab/index.ts src/backends/jira/index.ts src/backends/jira/mappers.ts src/backends/ado/index.ts
git commit -m "feat: return Iteration objects with dates from all backends"
```

---

### Task 6: Update CLI to display iteration dates

**Files:**
- Modify: `src/cli/commands/iteration.ts`
- Modify: `src/cli/index.ts:700-728`

**Step 1: Update `IterationListResult` in `src/cli/commands/iteration.ts`**

```typescript
import type { Backend } from '../../backends/types.js';
import type { Iteration } from '../../types.js';

export interface IterationListResult {
  iterations: Iteration[];
  current: string;
}

export async function runIterationList(
  backend: Backend,
): Promise<IterationListResult> {
  return {
    iterations: await backend.getIterations(),
    current: await backend.getCurrentIteration(),
  };
}

export async function runIterationSet(
  backend: Backend,
  name: string,
): Promise<void> {
  await backend.setCurrentIteration(name);
}
```

**Step 2: Update CLI output in `src/cli/index.ts`**

Change the `iteration list` action (lines ~710-728). Import the formatting utils:

```typescript
// At top or inline import in the action:
const { formatIterationDates, getIterationStatus } = await import('../iteration-utils.js');
```

Change the text output loop:
```typescript
// Old:
for (const iter of result.iterations) {
  const marker = iter === result.current ? '*' : ' ';
  console.log(`${marker}\t${iter}`);
}
// New:
for (const iter of result.iterations) {
  const marker = iter.name === result.current ? '*' : ' ';
  const dates = formatIterationDates(iter.startDate, iter.endDate);
  const status = getIterationStatus(iter.startDate, iter.endDate);
  const parts = [marker, iter.name];
  if (dates) parts.push(dates);
  if (status) parts.push(`(${status})`);
  console.log(parts.join('\t'));
}
```

**Step 3: Build and verify**

Run: `npm run build`
Expected: PASS

**Step 4: Commit**

```bash
git add src/cli/commands/iteration.ts src/cli/index.ts
git commit -m "feat: show iteration dates and status in CLI output"
```

---

### Task 7: Update MCP tools

**Files:**
- Modify: `src/cli/commands/mcp.ts:83-96`

**Step 1: Verify `handleGetConfig` works with `Iteration[]`**

The `handleGetConfig` function calls `backend.getIterations()` which now returns `Iteration[]`. The result is passed to `success()` which serializes to JSON. This should work automatically since `Iteration` objects are JSON-serializable.

Verify no type errors:
Run: `npm run build`

If there are any consumers that expect `iterations` to be `string[]` in the MCP response, update them to handle `Iteration[]`.

**Step 2: Commit (if any changes needed)**

```bash
git add src/cli/commands/mcp.ts
git commit -m "feat: return iteration dates in MCP get_config response"
```

---

### Task 8: Update IterationPicker to show dates and status

**Files:**
- Modify: `src/components/IterationPicker.tsx`

**Step 1: Update IterationPicker**

The full updated file:

```typescript
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import { useThemeStore } from '../stores/themeStore.js';
import { useNavigationStore } from '../stores/navigationStore.js';
import {
  useBackendDataStore,
  backendDataStore,
} from '../stores/backendDataStore.js';
import { matchesCommand } from '../commands.js';
import { formatIterationDates, getIterationStatus } from '../iteration-utils.js';

export function IterationPicker() {
  const { mutedDim } = useThemeStore((s) => s.colors);
  const backend = useBackendDataStore((s) => s.backend);
  const navigate = useNavigationStore((s) => s.navigate);
  const navigateToHelp = useNavigationStore((s) => s.navigateToHelp);
  const iterations = useBackendDataStore((s) => s.iterations);
  const current = useBackendDataStore((s) => s.currentIteration);

  useInput((_input, key) => {
    if (key.escape) navigate('list');
    if (matchesCommand('help', _input, key)) navigateToHelp('iteration-picker');
  });

  const items = iterations.map((it) => {
    const dates = formatIterationDates(it.startDate, it.endDate);
    const status = getIterationStatus(it.startDate, it.endDate);
    let label = it.name;
    if (it.name === current) label += ' (current)';
    if (dates) label += `  ${dates}`;
    if (status) label += `  (${status})`;
    return { label, value: it.name };
  });

  if (!backend) return null;

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold>Select Iteration</Text>
        <Text color={mutedDim}> (esc to cancel)</Text>
      </Box>
      <SelectInput
        items={items}
        initialIndex={iterations.findIndex((it) => it.name === current)}
        onSelect={(item) => {
          void (async () => {
            await backend.setCurrentIteration(item.value);
            await backendDataStore.getState().refresh();
            navigate('list');
          })();
        }}
      />
    </Box>
  );
}
```

Key changes:
- Import `formatIterationDates` and `getIterationStatus`
- Build label with dates and temporal status
- `iterations` is now `Iteration[]` so use `it.name` for comparisons
- `initialIndex` uses `findIndex` with `it.name === current`

**Step 2: Build and verify**

Run: `npm run build`
Expected: PASS

**Step 3: Commit**

```bash
git add src/components/IterationPicker.tsx
git commit -m "feat: show iteration dates and status in IterationPicker"
```

---

### Task 9: Update WorkItemList header to show dates

**Files:**
- Modify: `src/components/WorkItemList.tsx:274,1431-1434`

**Step 1: Update imports and selectors**

Add import:
```typescript
import { formatIterationDates } from '../iteration-utils.js';
```

Add a selector for the full iterations list near the existing `currentIteration` selector (line ~274):
```typescript
const iteration = useBackendDataStore((s) => s.currentIteration);
const iterations = useBackendDataStore((s) => s.iterations);
```

**Step 2: Compute date string for header**

Near the header JSX (before the return or in a useMemo), compute:
```typescript
const currentIterationDates = iterations.find((it) => it.name === iteration);
const iterationDateStr = currentIterationDates
  ? formatIterationDates(currentIterationDates.startDate, currentIterationDates.endDate)
  : null;
```

**Step 3: Update header JSX**

Change line ~1434:
```tsx
{/* Old: */}
{typeLabel} — {iteration}
{/* New: */}
{typeLabel} — {iteration}{iterationDateStr ? ` (${iterationDateStr})` : ''}
```

**Step 4: Build and verify**

Run: `npm run build`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/WorkItemList.tsx
git commit -m "feat: show iteration dates in WorkItemList header"
```

---

### Task 10: Update Settings default-iteration-picker

**Files:**
- Modify: `src/components/Settings.tsx:786-800`

**Step 1: Update the overlay items mapping**

Change lines ~789:
```typescript
// Old:
items={config.iterations.map((i) => ({ id: i, label: i, value: i }))}
// New:
items={config.iterations.map((i) => ({
  id: i.name,
  label: i.name,
  value: i.name,
}))}
```

**Step 2: Also update the settings item display for current iteration**

Check line ~565 where the current iteration is displayed and update if it references `config.iterations` as strings.

**Step 3: Build and verify**

Run: `npm run build`
Expected: PASS

**Step 4: Commit**

```bash
git add src/components/Settings.tsx
git commit -m "feat: update Settings to work with Iteration objects"
```

---

### Task 11: Fix remaining consumers and type errors

**Files:**
- Various files that consume `iterations` as `string[]`

**Step 1: Build and identify all remaining type errors**

Run: `npm run build 2>&1 | head -100`

Common patterns to fix:
- Any code comparing iterations as strings (e.g., `iterations.includes(name)` → `iterations.some(i => i.name === name)`)
- Any code mapping iterations to strings for display
- The `backendDataStore` init path in `createBackendAndSync()` if it references iterations
- Test files that mock or create iterations as strings

**Step 2: Fix each error**

For each type error, update the code to use `Iteration` objects. Common fixes:
- `iterations.includes(x)` → `iterations.some(i => i.name === x)`
- `iterations.map(i => ...)` where `i` was a string → use `i.name`
- Mock data in tests: `['sprint-1']` → `[{ name: 'sprint-1', startDate: null, endDate: null }]`

**Step 3: Run full test suite**

Run: `npm test`
Expected: PASS (all tests)

**Step 4: Run lint and format**

Run: `npm run lint:fix && npm run format`

**Step 5: Commit**

```bash
git add -A
git commit -m "fix: update all iteration consumers to use Iteration objects"
```

---

### Task 12: Final verification

**Step 1: Full build**

Run: `npm run build`
Expected: PASS — no type errors

**Step 2: Full test suite**

Run: `npm test`
Expected: PASS — all tests pass

**Step 3: Lint and format**

Run: `npm run lint && npm run format:check`
Expected: PASS

**Step 4: Manual smoke test (optional)**

Run: `npm start`
- Verify iteration picker shows dates if configured
- Verify header shows dates
- Verify `tic iteration list` shows dates in CLI
