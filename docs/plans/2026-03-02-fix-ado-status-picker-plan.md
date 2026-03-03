# Fix ADO Status Picker Duplicates and Missing Colors — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix two bugs in the status picker: each status row shows the status name twice, and some statuses render without colors.

**Architecture:** Two small, independent changes — (1) OverlayPanel hides the plain-text label when a ColorPill is already rendering the value, and (2) themeStore adds keyword defaults for common ADO statuses and a hash-based color fallback for status/type/priority fields (extending the existing label hash pattern).

**Tech Stack:** TypeScript, React/Ink, Zustand, Vitest

---

### Task 1: Add hash fallback and new keyword defaults in themeStore

**Files:**
- Modify: `src/stores/themeStore.ts:76-90` (keyword defaults), `src/stores/themeStore.ts:206-234` (resolveFieldColor)
- Modify: `src/stores/themeStore.test.ts` (update and add tests)

**Step 1: Write failing tests for hash fallback and new keywords**

Add these tests to `src/stores/themeStore.test.ts`:

In the `keyword defaults` describe block, add:

```typescript
it('returns green for "resolved" status', () => {
  const result = themeStore
    .getState()
    .resolveFieldColor('status', 'Resolved');
  expect(result).toEqual({ bg: 'green', fg: 'white' });
});

it('returns red for "removed" status', () => {
  const result = themeStore
    .getState()
    .resolveFieldColor('status', 'Removed');
  expect(result).toEqual({ bg: 'red', fg: 'white' });
});

it('returns cyan for "design" status', () => {
  const result = themeStore
    .getState()
    .resolveFieldColor('status', 'Design');
  expect(result).toEqual({ bg: 'cyan', fg: 'black' });
});
```

Update the existing "returns null for unmatched value" test (line 56) — it should now return a hash color instead of null:

```typescript
it('returns a hash color for unmatched status', () => {
  const result = themeStore
    .getState()
    .resolveFieldColor('status', 'unknown-xyz');
  expect(result).not.toBeNull();
  expect(result).toHaveProperty('bg');
  expect(result).toHaveProperty('fg');
});
```

Add a new test in a new describe block after `label hashing`:

```typescript
describe('field value hashing (non-label)', () => {
  it('returns a color for any status value', () => {
    const result = themeStore
      .getState()
      .resolveFieldColor('status', 'SomeCustomStatus');
    expect(result).not.toBeNull();
  });

  it('returns a color for any type value', () => {
    const result = themeStore
      .getState()
      .resolveFieldColor('type', 'SomeCustomType');
    expect(result).not.toBeNull();
  });

  it('returns a color for any priority value', () => {
    const result = themeStore
      .getState()
      .resolveFieldColor('priority', 'SomeCustomPriority');
    expect(result).not.toBeNull();
  });

  it('is deterministic for statuses', () => {
    const a = themeStore
      .getState()
      .resolveFieldColor('status', 'CustomState');
    const b = themeStore
      .getState()
      .resolveFieldColor('status', 'CustomState');
    expect(a).toEqual(b);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/stores/themeStore.test.ts`
Expected: FAIL — "resolved"/"removed"/"design" don't match patterns, and unmatched statuses still return null.

**Step 3: Add keyword defaults and hash fallback**

In `src/stores/themeStore.ts`, add new patterns to `defaultDefaults.status` (after the `draft` rule at line 89):

```typescript
{ patterns: ['resolved'], color: { bg: 'green', fg: 'white' } },
{ patterns: ['removed'], color: { bg: 'red', fg: 'white' } },
{ patterns: ['design'], color: { bg: 'cyan', fg: 'black' } },
```

Add the same to `highContrastDefaults.status` (after the `draft` rule at line 121):

```typescript
{ patterns: ['resolved'], color: { bg: 'greenBright', fg: 'white' } },
{ patterns: ['removed'], color: { bg: 'redBright', fg: 'white' } },
{ patterns: ['design'], color: { bg: 'cyanBright', fg: 'black' } },
```

In `resolveFieldColor()`, change the label-only hash fallback (lines 228-231) to apply to all fields:

Replace:
```typescript
// 3. Label hash (labels only)
if (field === 'label') {
  return hashLabel(lower);
}

return null;
```

With:
```typescript
// 3. Hash fallback for all fields
return hashLabel(lower);
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/stores/themeStore.test.ts`
Expected: PASS — all tests including new ones.

**Step 5: Commit**

```bash
git add src/stores/themeStore.ts src/stores/themeStore.test.ts
git commit -m "feat: add hash color fallback for status/type/priority and ADO keyword defaults"
```

---

### Task 2: Hide duplicate label text in OverlayPanel when ColorPill is shown

**Files:**
- Modify: `src/components/OverlayPanel.tsx:245-255`

**Step 1: Fix the duplicate rendering**

In `src/components/OverlayPanel.tsx`, replace lines 245-255:

```tsx
<Box flexGrow={1} gap={1}>
  {fieldType && !item.value.startsWith('__') && (
    <ColorPill field={fieldType} value={item.value} />
  )}
  <Text
    color={isSelected ? accent : undefined}
    bold={isSelected}
  >
    {item.label}
  </Text>
</Box>
```

With:

```tsx
<Box flexGrow={1} gap={1}>
  {fieldType && !item.value.startsWith('__') ? (
    <ColorPill field={fieldType} value={item.value} />
  ) : (
    <Text
      color={isSelected ? accent : undefined}
      bold={isSelected}
    >
      {item.label}
    </Text>
  )}
</Box>
```

This changes the `&&` to a ternary: when `fieldType` is set and the value isn't a special `__` prefix, render only the `ColorPill`. Otherwise render only the label text.

**Step 2: Build to verify no type errors**

Run: `npx tsc --noEmit`
Expected: no errors.

**Step 3: Run existing OverlayPanel tests**

Run: `npx vitest run src/components/OverlayPanel.test.ts`
Expected: PASS (existing tests only test `filterItems` and `groupByCategory`, not rendering).

**Step 4: Commit**

```bash
git add src/components/OverlayPanel.tsx
git commit -m "fix: prevent duplicate status text in OverlayPanel when ColorPill is shown"
```

---

### Task 3: Final verification

**Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass.

**Step 2: Run lint and format checks**

Run: `npm run lint && npm run format:check`
Expected: No errors.
