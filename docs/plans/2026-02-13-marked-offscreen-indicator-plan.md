# Marked Item Off-Screen Indicator Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show directional arrows (↑N ↓N) in the header when marked items are scrolled off-screen.

**Architecture:** Extract a pure function `getMarkedDistribution` that counts how many marked items are above/below the viewport. Use it in WorkItemList header rendering to conditionally append arrows.

**Tech Stack:** TypeScript, React (useMemo), Vitest

---

### Task 1: Create `getMarkedDistribution` helper with tests

**Files:**
- Create: `src/components/getMarkedDistribution.ts`
- Create: `src/components/getMarkedDistribution.test.ts`

**Step 1: Write the failing test**

```typescript
// src/components/getMarkedDistribution.test.ts
import { describe, it, expect } from 'vitest';
import { getMarkedDistribution } from './getMarkedDistribution.js';

describe('getMarkedDistribution', () => {
  // Helper: create tree items with given ids
  const items = (ids: string[]) => ids.map((id) => ({ id }) as { id: string });

  it('returns zeros when no items are marked', () => {
    const result = getMarkedDistribution(new Set(), items(['1', '2', '3']), 0, 3);
    expect(result).toEqual({ above: 0, below: 0 });
  });

  it('returns zeros when all marked items are visible', () => {
    const result = getMarkedDistribution(new Set(['2', '3']), items(['1', '2', '3', '4']), 1, 3);
    expect(result).toEqual({ above: 0, below: 0 });
  });

  it('counts marked items above viewport', () => {
    const result = getMarkedDistribution(new Set(['1', '2']), items(['1', '2', '3', '4']), 2, 4);
    expect(result).toEqual({ above: 2, below: 0 });
  });

  it('counts marked items below viewport', () => {
    const result = getMarkedDistribution(new Set(['3', '4']), items(['1', '2', '3', '4']), 0, 2);
    expect(result).toEqual({ above: 0, below: 2 });
  });

  it('counts marked items in both directions', () => {
    const result = getMarkedDistribution(
      new Set(['1', '3', '5']),
      items(['1', '2', '3', '4', '5']),
      1,
      4,
    );
    expect(result).toEqual({ above: 1, below: 1 });
  });

  it('handles empty tree items', () => {
    const result = getMarkedDistribution(new Set(['1']), items([]), 0, 0);
    expect(result).toEqual({ above: 0, below: 0 });
  });

  it('ignores marked ids not in tree items', () => {
    const result = getMarkedDistribution(new Set(['999']), items(['1', '2', '3']), 0, 3);
    expect(result).toEqual({ above: 0, below: 0 });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/getMarkedDistribution.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```typescript
// src/components/getMarkedDistribution.ts
export function getMarkedDistribution(
  markedIds: Set<string>,
  treeItems: { id: string }[],
  viewportStart: number,
  viewportEnd: number,
): { above: number; below: number } {
  if (markedIds.size === 0) return { above: 0, below: 0 };

  let above = 0;
  let below = 0;

  for (let i = 0; i < treeItems.length; i++) {
    if (!markedIds.has(treeItems[i].id)) continue;
    if (i < viewportStart) above++;
    else if (i >= viewportEnd) below++;
  }

  return { above, below };
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/getMarkedDistribution.test.ts`
Expected: All 7 tests PASS

**Step 5: Commit**

```bash
git add src/components/getMarkedDistribution.ts src/components/getMarkedDistribution.test.ts
git commit -m "feat: add getMarkedDistribution helper with tests"
```

---

### Task 2: Integrate into WorkItemList header

**Files:**
- Modify: `src/components/WorkItemList.tsx:210,1273-1275`

**Step 1: Add import and useMemo**

At the top of WorkItemList.tsx, add import:

```typescript
import { getMarkedDistribution } from './getMarkedDistribution.js';
```

After line 210 (`const markedCount = markedIds.size;`), add:

```typescript
const markedDistribution = useMemo(
  () => getMarkedDistribution(markedIds, treeItems, viewport.start, viewport.end),
  [markedIds, treeItems, viewport.start, viewport.end],
);
```

**Step 2: Update header rendering**

Replace lines 1273-1275:

```tsx
{markedCount > 0 && (
  <Text color="magenta">{` ● ${markedCount} marked`}</Text>
)}
```

With:

```tsx
{markedCount > 0 && (
  <Text color="magenta">
    {` ● ${markedCount}`}
    {markedDistribution.above > 0 && ` ↑${markedDistribution.above}`}
    {markedDistribution.below > 0 && ` ↓${markedDistribution.below}`}
  </Text>
)}
```

**Step 3: Verify build**

Run: `npm run build`
Expected: No errors

**Step 4: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 5: Format and lint**

Run: `npm run format && npm run lint`
Expected: Clean

**Step 6: Commit**

```bash
git add src/components/WorkItemList.tsx
git commit -m "feat: show off-screen marked item indicators in header"
```
