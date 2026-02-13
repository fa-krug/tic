# Real-time Form Validation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add real-time field validation to WorkItemForm that validates on input commit, shows inline errors below fields, and blocks save when errors exist.

**Architecture:** A new `useFormValidation` hook runs pure in-memory validation (existence checks, cycle detection) against the items list from `backendDataStore`. Errors stored as `Record<string, string>`. Save gated on empty errors. Backend validation at save time remains as safety net.

**Tech Stack:** TypeScript, React hooks, Ink `<Text>` for error display, Vitest for testing.

---

### Task 1: Add `requiredFields` to `BackendCapabilities`

**Files:**
- Modify: `src/backends/types.ts:10-35` (add `requiredFields` to interface)

**Step 1: Add `requiredFields` to `BackendCapabilities`**

In `src/backends/types.ts`, add to the `BackendCapabilities` interface:

```typescript
export interface BackendCapabilities {
  relationships: boolean;
  customTypes: boolean;
  customStatuses: boolean;
  iterations: boolean;
  comments: boolean;
  fields: {
    priority: boolean;
    assignee: boolean;
    labels: boolean;
    parent: boolean;
    dependsOn: boolean;
  };
  templates: boolean;
  templateFields: {
    type: boolean;
    status: boolean;
    priority: boolean;
    assignee: boolean;
    labels: boolean;
    iteration: boolean;
    parent: boolean;
    dependsOn: boolean;
    description: boolean;
  };
  requiredFields?: string[];  // defaults to ['title'] if not specified
}
```

**Step 2: Verify build**

Run: `npm run build`
Expected: PASS — optional property, no consumers break.

**Step 3: Commit**

```bash
git add src/backends/types.ts
git commit -m "feat: add requiredFields to BackendCapabilities"
```

---

### Task 2: Create `useFormValidation` hook with tests (TDD)

**Files:**
- Create: `src/hooks/useFormValidation.ts`
- Create: `src/hooks/useFormValidation.test.ts`

**Step 1: Write failing tests**

Create `src/hooks/useFormValidation.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { validateFormFields, type ValidationInput } from './useFormValidation.js';
import type { WorkItem } from '../types.js';

function makeItem(overrides: Partial<WorkItem> & { id: string }): WorkItem {
  return {
    title: `Item ${overrides.id}`,
    type: 'issue',
    status: 'open',
    priority: 'medium',
    assignee: '',
    labels: [],
    description: '',
    created: '',
    updated: '',
    parent: null,
    dependsOn: [],
    iteration: '',
    comments: [],
    ...overrides,
  };
}

const items: WorkItem[] = [
  makeItem({ id: '1' }),
  makeItem({ id: '2', parent: '1' }),
  makeItem({ id: '3', parent: '2' }),
  makeItem({ id: '4', dependsOn: ['1'] }),
];

describe('validateFormFields', () => {
  // --- Title / required fields ---

  it('returns error when title is empty', () => {
    const errors = validateFormFields({
      fields: { title: '', parentId: '', dependsOn: '' },
      items,
      currentItemId: null,
      requiredFields: ['title'],
    });
    expect(errors.title).toBe('Title is required');
  });

  it('returns no error when title is set', () => {
    const errors = validateFormFields({
      fields: { title: 'Hello', parentId: '', dependsOn: '' },
      items,
      currentItemId: null,
      requiredFields: ['title'],
    });
    expect(errors.title).toBeUndefined();
  });

  // --- Parent validation ---

  it('returns error when parent does not exist', () => {
    const errors = validateFormFields({
      fields: { title: 'Test', parentId: '#999 - Missing', dependsOn: '' },
      items,
      currentItemId: null,
      requiredFields: ['title'],
    });
    expect(errors.parent).toBe('Parent #999 does not exist');
  });

  it('returns error for self-referencing parent', () => {
    const errors = validateFormFields({
      fields: { title: 'Test', parentId: '#1 - Item 1', dependsOn: '' },
      items,
      currentItemId: '1',
      requiredFields: ['title'],
    });
    expect(errors.parent).toBe('Cannot be its own parent');
  });

  it('returns error for circular parent chain', () => {
    // Item 3's parent is 2, whose parent is 1.
    // If we try to set item 1's parent to 3, that creates 1→3→2→1 cycle.
    const errors = validateFormFields({
      fields: { title: 'Test', parentId: '#3 - Item 3', dependsOn: '' },
      items,
      currentItemId: '1',
      requiredFields: ['title'],
    });
    expect(errors.parent).toBe('Circular parent chain detected');
  });

  it('returns no error for valid parent', () => {
    const errors = validateFormFields({
      fields: { title: 'Test', parentId: '#1 - Item 1', dependsOn: '' },
      items,
      currentItemId: null,
      requiredFields: ['title'],
    });
    expect(errors.parent).toBeUndefined();
  });

  // --- DependsOn validation ---

  it('returns error when dependency does not exist', () => {
    const errors = validateFormFields({
      fields: { title: 'Test', parentId: '', dependsOn: '#999 - Missing' },
      items,
      currentItemId: null,
      requiredFields: ['title'],
    });
    expect(errors.dependsOn).toBe('Dependency #999 does not exist');
  });

  it('returns error for self-dependency', () => {
    const errors = validateFormFields({
      fields: { title: 'Test', parentId: '', dependsOn: '#1 - Item 1' },
      items,
      currentItemId: '1',
      requiredFields: ['title'],
    });
    expect(errors.dependsOn).toBe('Cannot depend on itself');
  });

  it('returns error for circular dependency chain', () => {
    // Item 4 depends on 1. If we set item 1 to depend on 4, that creates 1→4→1 cycle.
    const errors = validateFormFields({
      fields: { title: 'Test', parentId: '', dependsOn: '#4 - Item 4' },
      items,
      currentItemId: '1',
      requiredFields: ['title'],
    });
    expect(errors.dependsOn).toBe('Circular dependency detected');
  });

  it('returns no error for valid dependency', () => {
    const errors = validateFormFields({
      fields: { title: 'Test', parentId: '', dependsOn: '#2 - Item 2' },
      items,
      currentItemId: '1',
      requiredFields: ['title'],
    });
    expect(errors.dependsOn).toBeUndefined();
  });

  it('validates multiple dependsOn IDs', () => {
    const errors = validateFormFields({
      fields: {
        title: 'Test',
        parentId: '',
        dependsOn: '#1 - Item 1, #999 - Missing',
      },
      items,
      currentItemId: null,
      requiredFields: ['title'],
    });
    expect(errors.dependsOn).toBe('Dependency #999 does not exist');
  });

  // --- Multiple errors ---

  it('returns multiple errors at once', () => {
    const errors = validateFormFields({
      fields: { title: '', parentId: '#999 - Missing', dependsOn: '#888 - Nope' },
      items,
      currentItemId: null,
      requiredFields: ['title'],
    });
    expect(errors.title).toBe('Title is required');
    expect(errors.parent).toBe('Parent #999 does not exist');
    expect(errors.dependsOn).toBe('Dependency #888 does not exist');
  });

  // --- Empty parent/dependsOn are valid ---

  it('skips validation for empty parent', () => {
    const errors = validateFormFields({
      fields: { title: 'Test', parentId: '', dependsOn: '' },
      items,
      currentItemId: null,
      requiredFields: ['title'],
    });
    expect(errors.parent).toBeUndefined();
  });

  // --- Custom required fields ---

  it('validates custom required fields from capabilities', () => {
    const errors = validateFormFields({
      fields: { title: 'Test', parentId: '', dependsOn: '' },
      items,
      currentItemId: null,
      requiredFields: ['title', 'type'],
      fieldValues: { type: '' },
    });
    expect(errors.type).toBe('Type is required');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/hooks/useFormValidation.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement `validateFormFields` and `useFormValidation` hook**

Create `src/hooks/useFormValidation.ts`:

```typescript
import { useState, useCallback } from 'react';
import type { WorkItem } from '../types.js';

export interface ValidationInput {
  fields: { title: string; parentId: string; dependsOn: string };
  items: WorkItem[];
  currentItemId: string | null;
  requiredFields: string[];
  fieldValues?: Record<string, string>;
}

/** Parse an ID from "#123 - Title" format, falling back to raw input */
function parseId(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const match = trimmed.match(/^#(\S+)\s*-\s/);
  return match ? match[1]! : trimmed;
}

export function validateFormFields(input: ValidationInput): Record<string, string> {
  const { fields, items, currentItemId, requiredFields, fieldValues } = input;
  const errors: Record<string, string> = {};
  const itemMap = new Map(items.map((item) => [item.id, item]));

  // Required fields
  if (requiredFields.includes('title') && !fields.title.trim()) {
    errors.title = 'Title is required';
  }
  if (fieldValues) {
    for (const field of requiredFields) {
      if (field === 'title') continue; // handled above
      if (field in fieldValues && !fieldValues[field]!.trim()) {
        const label = field.charAt(0).toUpperCase() + field.slice(1);
        errors[field] = `${label} is required`;
      }
    }
  }

  // Parent validation
  const parentRaw = fields.parentId.trim();
  if (parentRaw) {
    const parentId = parseId(parentRaw);

    if (currentItemId && parentId === currentItemId) {
      errors.parent = 'Cannot be its own parent';
    } else if (!itemMap.has(parentId)) {
      errors.parent = `Parent #${parentId} does not exist`;
    } else {
      // Walk parent chain to detect cycles
      let current: string | null = parentId;
      const visited = new Set<string>();
      let circular = false;
      while (current !== null) {
        if (current === currentItemId) {
          circular = true;
          break;
        }
        if (visited.has(current)) break;
        visited.add(current);
        const item = itemMap.get(current);
        current = item?.parent ?? null;
      }
      if (circular) {
        errors.parent = 'Circular parent chain detected';
      }
    }
  }

  // DependsOn validation
  const depsRaw = fields.dependsOn.trim();
  if (depsRaw) {
    const depIds = depsRaw
      .split(',')
      .map((s) => parseId(s))
      .filter((s) => s.length > 0);

    for (const depId of depIds) {
      if (currentItemId && depId === currentItemId) {
        errors.dependsOn = 'Cannot depend on itself';
        break;
      }
      if (!itemMap.has(depId)) {
        errors.dependsOn = `Dependency #${depId} does not exist`;
        break;
      }
      // Circular dependency check: DFS from depId looking for currentItemId
      if (currentItemId) {
        const visited = new Set<string>();
        const stack = [depId];
        let circular = false;
        while (stack.length > 0) {
          const cur = stack.pop()!;
          if (cur === currentItemId) {
            circular = true;
            break;
          }
          if (visited.has(cur)) continue;
          visited.add(cur);
          const item = itemMap.get(cur);
          if (item) {
            for (const d of item.dependsOn) {
              stack.push(d);
            }
          }
        }
        if (circular) {
          errors.dependsOn = 'Circular dependency detected';
          break;
        }
      }
    }
  }

  return errors;
}

export function useFormValidation(
  items: WorkItem[],
  currentItemId: string | null,
  requiredFields: string[],
) {
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = useCallback(
    (
      field: string,
      fields: { title: string; parentId: string; dependsOn: string },
      fieldValues?: Record<string, string>,
    ) => {
      const allErrors = validateFormFields({
        fields,
        items,
        currentItemId,
        requiredFields,
        fieldValues,
      });

      if (field === 'all') {
        setErrors(allErrors);
        return Object.keys(allErrors).length > 0;
      }

      // Update only the validated field
      setErrors((prev) => {
        const next = { ...prev };
        if (allErrors[field]) {
          next[field] = allErrors[field];
        } else {
          delete next[field];
        }
        return next;
      });
      return !!allErrors[field];
    },
    [items, currentItemId, requiredFields],
  );

  const clearError = useCallback((field: string) => {
    setErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  const hasErrors = Object.keys(errors).length > 0;

  return { errors, validate, clearError, hasErrors };
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/hooks/useFormValidation.test.ts`
Expected: PASS — all tests green.

**Step 5: Commit**

```bash
git add src/hooks/useFormValidation.ts src/hooks/useFormValidation.test.ts
git commit -m "feat: add useFormValidation hook with tests (#17)"
```

---

### Task 3: Integrate validation into WorkItemForm — save gating

**Files:**
- Modify: `src/components/WorkItemForm.tsx`

**Step 1: Import and initialize the hook**

At the top of `WorkItemForm.tsx`, add the import:

```typescript
import { useFormValidation } from '../hooks/useFormValidation.js';
```

Inside `WorkItemForm()`, after the `requiredFields` useMemo (line ~254), add:

```typescript
const requiredFieldsList = useMemo(
  () => capabilities.requiredFields ?? [...requiredFields],
  [capabilities.requiredFields, requiredFields],
);

const {
  errors: validationErrors,
  validate,
  clearError,
  hasErrors: hasValidationErrors,
} = useFormValidation(allItems, selectedWorkItemId, requiredFieldsList);
```

**Step 2: Gate save on validation**

In the `'s'` key handler (line ~768), before `setSaving(true)`, add a validation gate:

```typescript
if (_input === 's') {
  // Run full validation before save
  const fieldValues: Record<string, string> = { type, status };
  const hasErr = validate(
    'all',
    { title, parentId, dependsOn },
    fieldValues,
  );
  if (hasErr) {
    uiStore
      .getState()
      .setToast('Fix validation errors before saving');
    return;
  }

  setSaving(true);
  // ... rest of save logic unchanged
```

**Step 3: Verify build**

Run: `npm run build`
Expected: PASS

**Step 4: Commit**

```bash
git add src/components/WorkItemForm.tsx
git commit -m "feat: gate form save on validation errors (#17)"
```

---

### Task 4: Add validation triggers on input commit

**Files:**
- Modify: `src/components/WorkItemForm.tsx`

**Step 1: Add validation to parent field `onSubmit`**

In the parent field's `AutocompleteInput` `onSubmit` callback (line ~1156):

```typescript
onSubmit={() => {
  setEditing(false);
  validate('parent', { title, parentId, dependsOn });
}}
```

And in `onCancel` (line ~1159), clear the parent error:

```typescript
onCancel={() => {
  setParentId(preEditValue);
  setEditing(false);
  clearError('parent');
}}
```

**Step 2: Add validation to dependsOn field `onSubmit`**

In the dependsOn field's `AutocompleteInput` `onSubmit` callback (line ~1223):

```typescript
onSubmit={() => {
  setEditing(false);
  validate('dependsOn', { title, parentId, dependsOn });
}}
```

And `onCancel` (line ~1226):

```typescript
onCancel={() => {
  setDependsOn(preEditValue);
  setEditing(false);
  clearError('dependsOn');
}}
```

**Step 3: Add validation on field focus change for required fields**

In the `setFocusedField` logic (arrow key handlers, line ~790-795), add validation for the field being left:

```typescript
if (key.upArrow) {
  const leavingField = fields[focusedField];
  if (leavingField === 'title') {
    validate('title', { title, parentId, dependsOn });
  }
  setFocusedField((f) => Math.max(0, f - 1));
}

if (key.downArrow) {
  const leavingField = fields[focusedField];
  if (leavingField === 'title') {
    validate('title', { title, parentId, dependsOn });
  }
  setFocusedField((f) => Math.min(fields.length - 1, f + 1));
}
```

**Step 4: Verify build**

Run: `npm run build`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/WorkItemForm.tsx
git commit -m "feat: trigger validation on input commit and focus change (#17)"
```

---

### Task 5: Render inline error messages

**Files:**
- Modify: `src/components/WorkItemForm.tsx`

**Step 1: Add error display below the parent field**

After the parent field's closing `</Box>` in both the editing and non-editing branches (lines ~1167 and ~1180), add:

For the editing branch (after the `AutocompleteInput` Box, inside the `flexDirection="column"` Box):

```typescript
{validationErrors.parent && (
  <Box marginLeft={4}>
    <Text color="red">{validationErrors.parent}</Text>
  </Box>
)}
```

For the non-editing branch, wrap in a `flexDirection="column"` Box and add the error:

```typescript
return (
  <Box key={field} flexDirection="column">
    <Box>
      <Text color={focused ? 'cyan' : undefined}>{cursor} </Text>
      <Text bold={focused} color={focused ? 'cyan' : undefined}>
        {label}:{dirtyIndicator}
        {isRequired && <Text dimColor> *</Text>}{' '}
      </Text>
      <Text>{parentId || <Text dimColor>(empty)</Text>}</Text>
    </Box>
    {validationErrors.parent && (
      <Box marginLeft={4}>
        <Text color="red">{validationErrors.parent}</Text>
      </Box>
    )}
  </Box>
);
```

**Step 2: Add error display below the dependsOn field**

Same pattern as parent field — add error line after both editing and non-editing branches of the dependsOn field (lines ~1235 and ~1247).

**Step 3: Add error display below the title field**

Find the title field rendering. Add after it:

```typescript
{validationErrors.title && (
  <Box marginLeft={4}>
    <Text color="red">{validationErrors.title}</Text>
  </Box>
)}
```

**Step 4: Add error display for other required fields (type, status)**

For any field that might be in `requiredFields`, add the same pattern using `validationErrors[field]`.

**Step 5: Verify build**

Run: `npm run build`
Expected: PASS

**Step 6: Run all tests**

Run: `npm test`
Expected: PASS — no regressions.

**Step 7: Format and commit**

```bash
npm run format
git add src/components/WorkItemForm.tsx
git commit -m "feat: render inline validation error messages (#17)"
```

---

### Task 6: Final verification

**Step 1: Run full build and test suite**

Run: `npm run build && npm test && npm run lint && npm run format:check`
Expected: All pass.

**Step 2: Manual smoke test (optional)**

Run: `npm start`
- Create a new item, leave title empty, press `s` → should see "Title is required" below title and toast
- Edit parent to `#999`, press enter to commit → should see "Parent #999 does not exist" inline
- Set parent to create a cycle → should see "Circular parent chain detected"
- Fix errors, press `s` → should save normally

**Step 3: Final commit if any formatting changes**

```bash
git add -A
git commit -m "feat: complete real-time form validation (#17)"
```
