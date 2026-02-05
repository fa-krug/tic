# Form Cancel/Discard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add field-level revert (Esc in edit mode), form-level dirty tracking with a save/discard/stay prompt, and Ctrl+S save-and-leave to WorkItemForm.

**Architecture:** Extract a `FormSnapshot` type representing all form field values. On form load, capture a snapshot. Compare current state to snapshot to derive `isDirty`. On field edit entry, capture `preEditValue` for single-field revert. On Esc in navigation mode when dirty, show a three-way prompt overlay.

**Tech Stack:** TypeScript, React 19, Ink 6

---

### Task 1: Extract snapshot type and comparison helper

**Files:**
- Create: `src/components/formSnapshot.ts`
- Test: `src/components/formSnapshot.test.ts`

**Step 1: Write the failing test**

```typescript
// src/components/formSnapshot.test.ts
import { describe, it, expect } from 'vitest';
import { createSnapshot, isSnapshotEqual } from './formSnapshot.js';

describe('createSnapshot', () => {
  it('creates a snapshot from form values', () => {
    const snap = createSnapshot({
      title: 'Bug fix',
      type: 'issue',
      status: 'open',
      iteration: 'sprint-1',
      priority: 'medium',
      assignee: 'alice',
      labels: 'bug, ui',
      description: 'Fix the thing',
      parentId: '#1 - Parent',
      dependsOn: '#2 - Dep',
      newComment: '',
    });
    expect(snap.title).toBe('Bug fix');
    expect(snap.assignee).toBe('alice');
  });
});

describe('isSnapshotEqual', () => {
  const base = createSnapshot({
    title: 'Bug fix',
    type: 'issue',
    status: 'open',
    iteration: '',
    priority: 'medium',
    assignee: '',
    labels: '',
    description: '',
    parentId: '',
    dependsOn: '',
    newComment: '',
  });

  it('returns true for identical snapshots', () => {
    const current = createSnapshot({
      title: 'Bug fix',
      type: 'issue',
      status: 'open',
      iteration: '',
      priority: 'medium',
      assignee: '',
      labels: '',
      description: '',
      parentId: '',
      dependsOn: '',
      newComment: '',
    });
    expect(isSnapshotEqual(base, current)).toBe(true);
  });

  it('returns false when title differs', () => {
    const current = createSnapshot({
      title: 'Changed',
      type: 'issue',
      status: 'open',
      iteration: '',
      priority: 'medium',
      assignee: '',
      labels: '',
      description: '',
      parentId: '',
      dependsOn: '',
      newComment: '',
    });
    expect(isSnapshotEqual(base, current)).toBe(false);
  });

  it('returns false when description differs', () => {
    const current = createSnapshot({
      title: 'Bug fix',
      type: 'issue',
      status: 'open',
      iteration: '',
      priority: 'medium',
      assignee: '',
      labels: '',
      description: 'new desc',
      parentId: '',
      dependsOn: '',
      newComment: '',
    });
    expect(isSnapshotEqual(base, current)).toBe(false);
  });

  it('returns false when newComment is non-empty', () => {
    const current = createSnapshot({
      title: 'Bug fix',
      type: 'issue',
      status: 'open',
      iteration: '',
      priority: 'medium',
      assignee: '',
      labels: '',
      description: '',
      parentId: '',
      dependsOn: '',
      newComment: 'a comment',
    });
    expect(isSnapshotEqual(base, current)).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/formSnapshot.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// src/components/formSnapshot.ts
export interface FormValues {
  title: string;
  type: string;
  status: string;
  iteration: string;
  priority: string;
  assignee: string;
  labels: string;
  description: string;
  parentId: string;
  dependsOn: string;
  newComment: string;
}

export type FormSnapshot = Readonly<FormValues>;

export function createSnapshot(values: FormValues): FormSnapshot {
  return { ...values };
}

export function isSnapshotEqual(a: FormSnapshot, b: FormSnapshot): boolean {
  return (
    a.title === b.title &&
    a.type === b.type &&
    a.status === b.status &&
    a.iteration === b.iteration &&
    a.priority === b.priority &&
    a.assignee === b.assignee &&
    a.labels === b.labels &&
    a.description === b.description &&
    a.parentId === b.parentId &&
    a.dependsOn === b.dependsOn &&
    a.newComment === b.newComment
  );
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/formSnapshot.test.ts`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add src/components/formSnapshot.ts src/components/formSnapshot.test.ts
git commit -m "feat: add FormSnapshot type and comparison helper for dirty tracking"
```

---

### Task 2: Add snapshot and isDirty to WorkItemForm

**Files:**
- Modify: `src/components/WorkItemForm.tsx`

This task wires up the snapshot without changing any behavior yet. The snapshot is captured after the existing item loads (or on mount for new items), and `isDirty` is derived.

**Step 1: Add imports and snapshot state**

At the top of `WorkItemForm.tsx`, add the import:

```typescript
import { createSnapshot, isSnapshotEqual, type FormSnapshot } from './formSnapshot.js';
```

After the existing field state declarations (line 200, after `const [comments, setComments] = useState<Comment[]>([]);`), add:

```typescript
const [initialSnapshot, setInitialSnapshot] = useState<FormSnapshot | null>(null);
```

**Step 2: Capture snapshot when existing item loads**

In the `useEffect` that syncs form fields from `existingItem` (the one starting at line 203), add at the end of the callback (after `setComments(...)` on line 231, before the closing `}` of the if-block):

```typescript
    setInitialSnapshot(
      createSnapshot({
        title: existingItem.title,
        type: existingItem.type,
        status: existingItem.status,
        iteration: existingItem.iteration,
        priority: existingItem.priority ?? 'medium',
        assignee: existingItem.assignee ?? '',
        labels: existingItem.labels.join(', '),
        description: existingItem.description ?? '',
        parentId:
          existingItem.parent !== null && existingItem.parent !== undefined
            ? (() => {
                const pi = allItems.find((i) => i.id === existingItem.parent);
                return pi
                  ? `#${existingItem.parent} - ${pi.title}`
                  : String(existingItem.parent);
              })()
            : '',
        dependsOn:
          existingItem.dependsOn
            ?.map((depId) => {
              const depItem = allItems.find((i) => i.id === depId);
              return depItem ? `#${depId} - ${depItem.title}` : depId;
            })
            .join(', ') ?? '',
        newComment: '',
      }),
    );
```

**Step 3: Capture snapshot for new items (create mode)**

Add a new `useEffect` after the template prefill effect (after line 251). This captures the snapshot once config is loaded and the form has settled for new items:

```typescript
  // Capture initial snapshot for new items once config finishes loading
  useEffect(() => {
    if (selectedWorkItemId !== null || configLoading || initialSnapshot !== null)
      return;
    setInitialSnapshot(
      createSnapshot({
        title,
        type,
        status,
        iteration,
        priority,
        assignee,
        labels,
        description,
        parentId,
        dependsOn,
        newComment,
      }),
    );
  }, [selectedWorkItemId, configLoading]);
```

**Step 4: Capture snapshot for template editing**

In the `useEffect` that loads existing templates (starting at line 254), add snapshot capture in the `.then()` callback after all the field setters, before the closing `}`:

```typescript
      setInitialSnapshot(
        createSnapshot({
          title: t.name,
          type: t.type ?? type,
          status: t.status ?? status,
          iteration: t.iteration ?? iteration,
          priority: t.priority ?? priority,
          assignee: t.assignee ?? assignee,
          labels: t.labels != null ? t.labels.join(', ') : labels,
          description: t.description ?? description,
          parentId: t.parent != null ? String(t.parent) : parentId,
          dependsOn: t.dependsOn != null ? t.dependsOn.join(', ') : dependsOn,
          newComment: '',
        }),
      );
```

**Step 5: Derive isDirty**

After the `initialSnapshot` state declaration, add:

```typescript
  const currentValues = createSnapshot({
    title,
    type,
    status,
    iteration,
    priority,
    assignee,
    labels,
    description,
    parentId,
    dependsOn,
    newComment,
  });
  const isDirty = initialSnapshot !== null && !isSnapshotEqual(initialSnapshot, currentValues);
```

**Step 6: Update snapshot after successful save**

In the `save()` function, at the very end (just before the closing `}`), add:

```typescript
    setInitialSnapshot(
      createSnapshot({
        title,
        type,
        status,
        iteration,
        priority,
        assignee,
        labels,
        description,
        parentId,
        dependsOn,
        newComment: '',
      }),
    );
```

**Step 7: Run build to verify no type errors**

Run: `npm run build`
Expected: PASS — no type errors, behavior unchanged

**Step 8: Commit**

```bash
git add src/components/WorkItemForm.tsx
git commit -m "feat: add dirty tracking snapshot to WorkItemForm"
```

---

### Task 3: Field-level Esc revert

**Files:**
- Modify: `src/components/WorkItemForm.tsx`

**Step 1: Add preEditValue state**

After the `editing` state declaration (line 282), add:

```typescript
  const [preEditValue, setPreEditValue] = useState<string>('');
```

**Step 2: Capture value when entering edit mode**

In the `useInput` callback, find where `setEditing(true)` is called (line 466). Before it, add value capture:

```typescript
            // Capture current value before editing for revert on Esc
            const fieldValue = (() => {
              switch (currentField) {
                case 'title': return title;
                case 'assignee': return assignee;
                case 'labels': return labels;
                case 'parent': return parentId;
                case 'dependsOn': return dependsOn;
                case 'comments': return newComment;
                default: return '';
              }
            })();
            setPreEditValue(fieldValue);
            setEditing(true);
```

Replace the existing `setEditing(true);` on line 466.

**Step 3: Revert on Esc in edit mode**

In the `useInput` callback, find the `else` branch for `editing` mode (line 469-472):

```typescript
      } else {
        if (key.escape) {
          setEditing(false);
        }
      }
```

Replace with:

```typescript
      } else {
        if (key.escape) {
          // Revert field to value before editing started
          switch (currentField) {
            case 'title': setTitle(preEditValue); break;
            case 'assignee': setAssignee(preEditValue); break;
            case 'labels': setLabels(preEditValue); break;
            case 'parent': setParentId(preEditValue); break;
            case 'dependsOn': setDependsOn(preEditValue); break;
            case 'comments': setNewComment(preEditValue); break;
            // Select fields (type, status, iteration, priority) already
            // require Enter to confirm, so Esc naturally discards
          }
          setEditing(false);
        }
      }
```

**Step 4: Run build to verify no type errors**

Run: `npm run build`
Expected: PASS

**Step 5: Run all tests**

Run: `npm test`
Expected: PASS — all existing tests still pass

**Step 6: Commit**

```bash
git add src/components/WorkItemForm.tsx
git commit -m "feat: revert field value on Esc during edit mode"
```

---

### Task 4: Dirty prompt on Esc in navigation mode

**Files:**
- Modify: `src/components/WorkItemForm.tsx`

**Step 1: Add dirty prompt state**

After the `preEditValue` state, add:

```typescript
  const [showDirtyPrompt, setShowDirtyPrompt] = useState(false);
  const [pendingRelNav, setPendingRelNav] = useState<string | null>(null);
```

`pendingRelNav` stores a target item ID when the user tried to navigate a relationship while dirty — the navigation completes after save/discard.

**Step 2: Add dirty prompt guard in useInput**

At the very top of the `useInput` callback (line 405, after `(_input, key) => {`), add:

```typescript
      // Dirty prompt overlay — capture s/d/esc only
      if (showDirtyPrompt) {
        if (_input === 's' && (selectedWorkItemId !== null || title.trim())) {
          void (async () => {
            await save();
            if (pendingRelNav) {
              pushWorkItem(pendingRelNav);
              setPendingRelNav(null);
            } else if (formMode === 'template') {
              setFormMode('item');
              setEditingTemplateSlug(null);
              navigate('settings');
            } else {
              const prev = popWorkItem();
              if (prev === null) navigate('list');
            }
          })();
          setShowDirtyPrompt(false);
          return;
        }
        if (_input === 'd') {
          // Discard: navigate back without saving
          if (pendingRelNav) {
            pushWorkItem(pendingRelNav);
            setPendingRelNav(null);
          } else if (formMode === 'template') {
            setFormMode('item');
            setEditingTemplateSlug(null);
            navigate('settings');
          } else {
            const prev = popWorkItem();
            if (prev === null) navigate('list');
          }
          setShowDirtyPrompt(false);
          return;
        }
        if (key.escape) {
          setShowDirtyPrompt(false);
          setPendingRelNav(null);
          return;
        }
        // Ignore all other keys while prompt is showing
        return;
      }
```

**Step 3: Modify Esc in navigation mode to check dirty state**

Replace the existing Esc handler block (lines 407-421):

```typescript
      // Allow Esc to navigate back even while loading
      if (key.escape && !editing) {
        if (!configLoading && !itemLoading && !saving) {
          void save();
        }
        if (formMode === 'template') {
          setFormMode('item');
          setEditingTemplateSlug(null);
          navigate('settings');
        } else {
          const prev = popWorkItem();
          if (prev === null) {
            navigate('list');
          }
        }
        return;
      }
```

With:

```typescript
      // Esc in navigation mode
      if (key.escape && !editing) {
        if (configLoading || itemLoading || saving) {
          // Allow escape even while loading (no save)
          if (formMode === 'template') {
            setFormMode('item');
            setEditingTemplateSlug(null);
            navigate('settings');
          } else {
            const prev = popWorkItem();
            if (prev === null) navigate('list');
          }
          return;
        }
        if (isDirty) {
          setShowDirtyPrompt(true);
          return;
        }
        // Clean — just go back
        if (formMode === 'template') {
          setFormMode('item');
          setEditingTemplateSlug(null);
          navigate('settings');
        } else {
          const prev = popWorkItem();
          if (prev === null) navigate('list');
        }
        return;
      }
```

**Step 4: Modify relationship navigation to check dirty state**

Replace the relationship navigation block (lines 440-455):

```typescript
          if (isRelationshipField) {
            let targetId: string | null = null;
            if (currentField === 'rel-parent' && existingItem?.parent) {
              targetId = existingItem.parent;
            } else if (currentField.startsWith('rel-child-')) {
              targetId = currentField.slice('rel-child-'.length);
            } else if (currentField.startsWith('rel-dependent-')) {
              targetId = currentField.slice('rel-dependent-'.length);
            }
            if (targetId) {
              setSaving(true);
              void (async () => {
                await save();
                pushWorkItem(targetId);
              })();
            }
```

With:

```typescript
          if (isRelationshipField) {
            let targetId: string | null = null;
            if (currentField === 'rel-parent' && existingItem?.parent) {
              targetId = existingItem.parent;
            } else if (currentField.startsWith('rel-child-')) {
              targetId = currentField.slice('rel-child-'.length);
            } else if (currentField.startsWith('rel-dependent-')) {
              targetId = currentField.slice('rel-dependent-'.length);
            }
            if (targetId) {
              if (isDirty) {
                setPendingRelNav(targetId);
                setShowDirtyPrompt(true);
              } else {
                pushWorkItem(targetId);
              }
            }
```

**Step 5: Disable main useInput while prompt is showing**

Update the `isActive` condition of `useInput` (line 476-484). Add `!showDirtyPrompt` — but actually the guard at the top of the callback already returns early, so this isn't strictly needed. The guard approach is sufficient.

**Step 6: Render the dirty prompt**

Replace the help bar at the bottom of the JSX (lines 1011-1015):

```typescript
      <Box marginTop={1}>
        <Text dimColor>
          {'↑↓ navigate  enter edit field  esc save & back  ? help'}
        </Text>
      </Box>
```

With:

```typescript
      <Box marginTop={1}>
        {showDirtyPrompt ? (
          <Text>
            {selectedWorkItemId !== null || title.trim() ? (
              <Text>
                Unsaved changes:{' '}
                <Text color="green" bold>(s)</Text>
                <Text>ave  </Text>
                <Text color="red" bold>(d)</Text>
                <Text>iscard  </Text>
                <Text color="yellow" bold>(esc)</Text>
                <Text> stay</Text>
              </Text>
            ) : (
              <Text>
                Discard new item?{' '}
                <Text color="red" bold>(d)</Text>
                <Text>iscard  </Text>
                <Text color="yellow" bold>(esc)</Text>
                <Text> stay</Text>
              </Text>
            )}
          </Text>
        ) : (
          <Text dimColor>
            {editing
              ? 'enter confirm  esc revert  ? help'
              : isDirty
                ? '↑↓ navigate  enter edit  ctrl+s save & back  esc back (unsaved changes)  ? help'
                : '↑↓ navigate  enter edit  ctrl+s save & back  esc back  ? help'}
          </Text>
        )}
      </Box>
```

**Step 7: Run build**

Run: `npm run build`
Expected: PASS

**Step 8: Run all tests**

Run: `npm test`
Expected: PASS

**Step 9: Commit**

```bash
git add src/components/WorkItemForm.tsx
git commit -m "feat: add dirty prompt on Esc with save/discard/stay options"
```

---

### Task 5: Add Ctrl+S save-and-leave

**Files:**
- Modify: `src/components/WorkItemForm.tsx`

**Step 1: Add Ctrl+S handler**

In the `useInput` callback, in the `if (!editing)` block (after the `?` help shortcut check around line 426), add:

```typescript
        // Ctrl+S: save and go back
        if (key.ctrl && _input === 's') {
          setSaving(true);
          void (async () => {
            await save();
            if (formMode === 'template') {
              setFormMode('item');
              setEditingTemplateSlug(null);
              navigate('settings');
            } else {
              const prev = popWorkItem();
              if (prev === null) navigate('list');
            }
          })();
          return;
        }
```

**Step 2: Run build**

Run: `npm run build`
Expected: PASS

**Step 3: Run all tests**

Run: `npm test`
Expected: PASS

**Step 4: Commit**

```bash
git add src/components/WorkItemForm.tsx
git commit -m "feat: add Ctrl+S to save and leave form"
```

---

### Task 6: Update HelpScreen form shortcuts

**Files:**
- Modify: `src/components/HelpScreen.tsx`
- Test: `src/components/HelpScreen.test.tsx`

**Step 1: Write the failing test**

Add to `src/components/HelpScreen.test.tsx`:

```typescript
  it('includes ctrl+s and revert info in form shortcuts', () => {
    const groups = getShortcuts('form', fullCapabilities, true, true);
    const allShortcuts = groups.flatMap((g) => g.shortcuts);
    const keys = allShortcuts.map((s) => s.key);
    expect(keys).toContain('ctrl+s');
    expect(keys).toContain('esc');
    const escShortcuts = allShortcuts.filter((s) => s.key === 'esc');
    expect(escShortcuts.some((s) => s.description.includes('revert'))).toBe(true);
    expect(escShortcuts.some((s) => s.description.includes('discard'))).toBe(true);
  });
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/HelpScreen.test.tsx`
Expected: FAIL

**Step 3: Update the form case in getShortcuts**

In `src/components/HelpScreen.tsx`, replace the `case 'form':` block (lines 99-130):

```typescript
    case 'form': {
      return [
        {
          label: 'Navigation',
          shortcuts: [
            { key: '↑/↓', description: 'Move between fields' },
          ],
        },
        {
          label: 'Editing',
          shortcuts: [
            {
              key: 'enter',
              description: 'Edit field / open $EDITOR (description) / navigate to related item',
            },
            {
              key: 'esc',
              description: 'Revert field to previous value (in edit mode)',
            },
            {
              key: 'enter/select',
              description: 'Confirm field value',
            },
          ],
        },
        {
          label: 'Save & Exit',
          shortcuts: [
            {
              key: 'ctrl+s',
              description: 'Save and go back',
            },
            {
              key: 'esc',
              description: 'Go back (prompts to save/discard if unsaved changes)',
            },
          ],
        },
      ];
    }
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/HelpScreen.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/HelpScreen.tsx src/components/HelpScreen.test.tsx
git commit -m "feat: update form help screen with new save/discard shortcuts"
```

---

### Task 7: Final verification

**Step 1: Run full test suite**

Run: `npm test`
Expected: All tests PASS

**Step 2: Run format and lint**

Run: `npm run format && npm run lint`
Expected: PASS

**Step 3: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 4: Manual smoke test**

Run: `npm start`

Test these scenarios:
1. Open an item, don't change anything, press Esc → goes back immediately
2. Open an item, change title, press Esc → dirty prompt appears
3. In dirty prompt, press `s` → saves and goes back
4. In dirty prompt, press `d` → discards and goes back
5. In dirty prompt, press Esc → stays in form
6. Open an item, edit a field, press Esc in edit mode → field reverts
7. Open an item, change something, press Ctrl+S → saves and goes back
8. Create new item, type title, press Esc → dirty prompt with save option
9. Create new item, leave title empty, press Esc → dirty prompt with only discard/stay
10. Edit an item, change a field, click a relationship link → dirty prompt, then navigates after save/discard
