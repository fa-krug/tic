# Assignee Autocomplete Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add filter-as-you-type autocomplete to the assignee field in the TUI form, backed by a new `getAssignees()` method on each backend.

**Architecture:** Add `getAssignees(): string[]` to the Backend interface. Each backend implements it using its CLI tool or local data. A new `AutocompleteInput` Ink component provides the TUI interaction. WorkItemForm renders `AutocompleteInput` for the assignee field instead of `TextInput`.

**Tech Stack:** TypeScript, React/Ink, Vitest, ink-text-input

---

### Task 1: Add `getAssignees()` to Backend interface and BaseBackend

**Files:**
- Modify: `src/backends/types.ts:25-100`

**Step 1: Add `getAssignees()` to the `Backend` interface**

In `src/backends/types.ts`, add after `getWorkItemTypes(): string[];` (line 29):

```typescript
getAssignees(): string[];
```

**Step 2: Add abstract `getAssignees()` to `BaseBackend`**

In `src/backends/types.ts`, add after `abstract getWorkItemTypes(): string[];` (line 48):

```typescript
abstract getAssignees(): string[];
```

**Step 3: Add `getAssignees()` stub to `TestBackend` in `src/backends/base.test.ts`**

In the `TestBackend` class, add alongside the other abstract method stubs:

```typescript
getAssignees(): string[] {
  return [];
}
```

**Step 4: Verify tests still pass**

Run: `npx vitest run src/backends/base.test.ts`
Expected: PASS (no behavioral change)

**Step 5: Commit**

```bash
git add src/backends/types.ts src/backends/base.test.ts
git commit -m "feat: add getAssignees() to Backend interface"
```

---

### Task 2: Implement `getAssignees()` in LocalBackend

**Files:**
- Modify: `src/backends/local/index.ts:165-173`
- Test: `src/backends/local/index.test.ts`

**Step 1: Write the failing test**

Add to `src/backends/local/index.test.ts`:

```typescript
it('returns unique assignees from existing items', () => {
  backend.createWorkItem({
    title: 'A',
    type: 'task',
    status: 'todo',
    iteration: 'default',
    priority: 'low',
    assignee: 'alice',
    labels: [],
    description: '',
    parent: null,
    dependsOn: [],
  });
  backend.createWorkItem({
    title: 'B',
    type: 'task',
    status: 'todo',
    iteration: 'default',
    priority: 'low',
    assignee: 'bob',
    labels: [],
    description: '',
    parent: null,
    dependsOn: [],
  });
  backend.createWorkItem({
    title: 'C',
    type: 'task',
    status: 'todo',
    iteration: 'default',
    priority: 'low',
    assignee: 'alice',
    labels: [],
    description: '',
    parent: null,
    dependsOn: [],
  });
  backend.createWorkItem({
    title: 'D',
    type: 'task',
    status: 'todo',
    iteration: 'default',
    priority: 'low',
    assignee: '',
    labels: [],
    description: '',
    parent: null,
    dependsOn: [],
  });
  const assignees = backend.getAssignees();
  expect(assignees).toHaveLength(2);
  expect(assignees).toContain('alice');
  expect(assignees).toContain('bob');
});

it('returns empty array when no items have assignees', () => {
  expect(backend.getAssignees()).toEqual([]);
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/backends/local/index.test.ts`
Expected: FAIL — `getAssignees` is not implemented

**Step 3: Implement `getAssignees()` in `LocalBackend`**

Add to `src/backends/local/index.ts`, after the `getWorkItemTypes()` method:

```typescript
getAssignees(): string[] {
  const items = this.listWorkItems();
  const assignees = new Set<string>();
  for (const item of items) {
    if (item.assignee) {
      assignees.add(item.assignee);
    }
  }
  return [...assignees].sort();
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/backends/local/index.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/backends/local/index.ts src/backends/local/index.test.ts
git commit -m "feat(local): implement getAssignees() from existing items"
```

---

### Task 3: Implement `getAssignees()` in GitHubBackend

**Files:**
- Modify: `src/backends/github/index.ts`
- Test: `src/backends/github/github.test.ts`

**Step 1: Write the failing test**

Add to `src/backends/github/github.test.ts`:

```typescript
describe('getAssignees', () => {
  it('returns collaborator logins', () => {
    const backend = new GitHubBackend('/repo');
    mockGh
      .mockReturnValueOnce({ nameWithOwner: 'owner/repo' })
      .mockReturnValueOnce([
        { login: 'alice' },
        { login: 'bob' },
        { login: 'charlie' },
      ]);
    expect(backend.getAssignees()).toEqual(['alice', 'bob', 'charlie']);
  });

  it('returns empty array on error', () => {
    const backend = new GitHubBackend('/repo');
    mockGh.mockReturnValueOnce({ nameWithOwner: 'owner/repo' });
    mockGh.mockImplementationOnce(() => {
      throw new Error('API error');
    });
    expect(backend.getAssignees()).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/backends/github/github.test.ts`
Expected: FAIL — `getAssignees` is not implemented

**Step 3: Implement `getAssignees()` in `GitHubBackend`**

Add to `src/backends/github/index.ts`, after `getWorkItemTypes()`:

```typescript
getAssignees(): string[] {
  try {
    const owner = this.getRepoNwo();
    const collaborators = gh<{ login: string }[]>(
      ['api', `repos/${owner}/collaborators`, '--jq', '.'],
      this.cwd,
    );
    return collaborators.map((c) => c.login);
  } catch {
    return [];
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/backends/github/github.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/backends/github/index.ts src/backends/github/github.test.ts
git commit -m "feat(github): implement getAssignees() from collaborators"
```

---

### Task 4: Implement `getAssignees()` in GitLabBackend

**Files:**
- Modify: `src/backends/gitlab/index.ts`
- Test: `src/backends/gitlab/gitlab.test.ts`

**Step 1: Write the failing test**

Add to `src/backends/gitlab/gitlab.test.ts`:

```typescript
describe('getAssignees', () => {
  it('returns project member usernames', () => {
    const backend = makeBackend();
    mockGlab.mockReturnValueOnce([
      { username: 'alice' },
      { username: 'bob' },
    ]);
    expect(backend.getAssignees()).toEqual(['alice', 'bob']);
  });

  it('returns empty array on error', () => {
    const backend = makeBackend();
    mockGlab.mockImplementationOnce(() => {
      throw new Error('API error');
    });
    expect(backend.getAssignees()).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/backends/gitlab/gitlab.test.ts`
Expected: FAIL — `getAssignees` is not implemented

**Step 3: Implement `getAssignees()` in `GitLabBackend`**

Add to `src/backends/gitlab/index.ts`, after `getWorkItemTypes()`:

```typescript
getAssignees(): string[] {
  try {
    const members = glab<{ username: string }[]>(
      ['api', 'projects/:fullpath/members/all', '--paginate'],
      this.cwd,
    );
    return members.map((m) => m.username);
  } catch {
    return [];
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/backends/gitlab/gitlab.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/backends/gitlab/index.ts src/backends/gitlab/gitlab.test.ts
git commit -m "feat(gitlab): implement getAssignees() from project members"
```

---

### Task 5: Implement `getAssignees()` in AzureDevOpsBackend

**Files:**
- Modify: `src/backends/ado/index.ts`
- Test: `src/backends/ado/ado.test.ts`

**Step 1: Write the failing test**

Add to `src/backends/ado/ado.test.ts`:

```typescript
describe('getAssignees', () => {
  it('returns team member display names', () => {
    const backend = makeBackend();
    mockAz.mockReturnValueOnce([
      { identity: { displayName: 'Alice Smith' } },
      { identity: { displayName: 'Bob Jones' } },
    ]);
    expect(backend.getAssignees()).toEqual(['Alice Smith', 'Bob Jones']);
  });

  it('returns empty array on error', () => {
    const backend = makeBackend();
    mockAz.mockImplementationOnce(() => {
      throw new Error('API error');
    });
    expect(backend.getAssignees()).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/backends/ado/ado.test.ts`
Expected: FAIL — `getAssignees` is not implemented

**Step 3: Implement `getAssignees()` in `AzureDevOpsBackend`**

Add to `src/backends/ado/index.ts`, after `getWorkItemTypes()`:

```typescript
getAssignees(): string[] {
  try {
    const members = az<{ identity: { displayName: string } }[]>(
      [
        'devops',
        'team',
        'list-members',
        '--team',
        `${this.project} Team`,
        '--org',
        `https://dev.azure.com/${this.org}`,
        '--project',
        this.project,
      ],
      this.cwd,
    );
    return members.map((m) => m.identity.displayName);
  } catch {
    return [];
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/backends/ado/ado.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/backends/ado/index.ts src/backends/ado/ado.test.ts
git commit -m "feat(ado): implement getAssignees() from team members"
```

---

### Task 6: Create AutocompleteInput component with tests

**Files:**
- Create: `src/components/AutocompleteInput.tsx`
- Create: `src/components/AutocompleteInput.test.tsx`

**Step 1: Write the failing tests**

Create `src/components/AutocompleteInput.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { AutocompleteInput } from './AutocompleteInput.js';

describe('AutocompleteInput', () => {
  it('renders the current value', () => {
    const { lastFrame } = render(
      <AutocompleteInput
        value="ali"
        onChange={() => {}}
        onSubmit={() => {}}
        suggestions={['alice', 'bob']}
        focus={true}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('ali');
  });

  it('shows suggestions matching the input (case-insensitive)', () => {
    const { lastFrame } = render(
      <AutocompleteInput
        value="AL"
        onChange={() => {}}
        onSubmit={() => {}}
        suggestions={['alice', 'bob', 'ALBERT']}
        focus={true}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('alice');
    expect(frame).toContain('ALBERT');
    expect(frame).not.toContain('bob');
  });

  it('shows all suggestions (up to cap) when input is empty', () => {
    const { lastFrame } = render(
      <AutocompleteInput
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
        suggestions={['alice', 'bob', 'charlie']}
        focus={true}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('alice');
    expect(frame).toContain('bob');
    expect(frame).toContain('charlie');
  });

  it('caps visible suggestions at 5', () => {
    const suggestions = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const { lastFrame } = render(
      <AutocompleteInput
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
        suggestions={suggestions}
        focus={true}
      />,
    );
    const frame = lastFrame()!;
    // Only 5 should be visible
    expect(frame).toContain('a');
    expect(frame).toContain('e');
    expect(frame).not.toContain('f');
  });

  it('shows no suggestions when nothing matches', () => {
    const { lastFrame } = render(
      <AutocompleteInput
        value="zzz"
        onChange={() => {}}
        onSubmit={() => {}}
        suggestions={['alice', 'bob']}
        focus={true}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).not.toContain('alice');
    expect(frame).not.toContain('bob');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/AutocompleteInput.test.tsx`
Expected: FAIL — module not found

**Step 3: Implement AutocompleteInput component**

Create `src/components/AutocompleteInput.tsx`:

```tsx
import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

const MAX_VISIBLE = 5;

interface AutocompleteInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  suggestions: string[];
  focus: boolean;
}

export function AutocompleteInput({
  value,
  onChange,
  onSubmit,
  suggestions,
  focus,
}: AutocompleteInputProps) {
  const [highlightIndex, setHighlightIndex] = useState(-1);

  const filtered = value
    ? suggestions.filter((s) =>
        s.toLowerCase().includes(value.toLowerCase()),
      )
    : suggestions;

  const visible = filtered.slice(0, MAX_VISIBLE);

  useInput(
    (_input, key) => {
      if (key.downArrow) {
        setHighlightIndex((i) =>
          i < visible.length - 1 ? i + 1 : i,
        );
      }
      if (key.upArrow) {
        setHighlightIndex((i) => (i > -1 ? i - 1 : -1));
      }
      if (key.return) {
        if (highlightIndex >= 0 && highlightIndex < visible.length) {
          onChange(visible[highlightIndex]!);
        }
        onSubmit();
      }
    },
    { isActive: focus },
  );

  const handleChange = (newValue: string) => {
    onChange(newValue);
    setHighlightIndex(-1);
  };

  return (
    <Box flexDirection="column">
      <TextInput
        value={value}
        onChange={handleChange}
        focus={focus}
        onSubmit={() => {
          if (highlightIndex >= 0 && highlightIndex < visible.length) {
            onChange(visible[highlightIndex]!);
          }
          onSubmit();
        }}
      />
      {visible.length > 0 && (
        <Box flexDirection="column" marginLeft={2}>
          {visible.map((suggestion, i) => (
            <Text
              key={suggestion}
              color={i === highlightIndex ? 'cyan' : undefined}
              bold={i === highlightIndex}
            >
              {i === highlightIndex ? '> ' : '  '}
              {suggestion}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/AutocompleteInput.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/AutocompleteInput.tsx src/components/AutocompleteInput.test.tsx
git commit -m "feat(ui): add AutocompleteInput component"
```

---

### Task 7: Integrate AutocompleteInput into WorkItemForm

**Files:**
- Modify: `src/components/WorkItemForm.tsx`

**Step 1: Add import for AutocompleteInput**

At the top of `src/components/WorkItemForm.tsx`, add after the existing imports:

```typescript
import { AutocompleteInput } from './AutocompleteInput.js';
```

**Step 2: Add assignees state and fetch on mount**

After the `types` useMemo (line 70), add:

```typescript
const [assignees, setAssignees] = useState<string[]>([]);

useMemo(() => {
  try {
    setAssignees(backend.getAssignees());
  } catch {
    // Silently ignore — autocomplete just won't have suggestions
  }
}, [backend]);
```

Note: Since `getAssignees()` is synchronous (like all other backend methods), useMemo is fine.

**Step 3: Add assignee to a separate rendering branch**

In the `renderField` function, add a new branch before the text fields section (before the comment `// Text fields: title, assignee, labels, description, parent, dependsOn` on line 382). Add after the `SELECT_FIELDS` block (after line 380):

```typescript
if (field === 'assignee') {
  if (isEditing) {
    return (
      <Box key={field} flexDirection="column">
        <Box>
          <Text color="cyan">{cursor} </Text>
          <Text bold color="cyan">
            {label}:{' '}
          </Text>
        </Box>
        <Box marginLeft={4}>
          <AutocompleteInput
            value={assignee}
            onChange={setAssignee}
            onSubmit={() => {
              setEditing(false);
            }}
            suggestions={assignees}
            focus={true}
          />
        </Box>
      </Box>
    );
  }

  return (
    <Box key={field}>
      <Text color={focused ? 'cyan' : undefined}>{cursor} </Text>
      <Text bold={focused} color={focused ? 'cyan' : undefined}>
        {label}:{' '}
      </Text>
      <Text>{assignee || <Text dimColor>(empty)</Text>}</Text>
    </Box>
  );
}
```

**Step 4: Remove 'assignee' from the text field rendering path**

In the `textValue` chain (lines 383-394), remove the `field === 'assignee'` branch:

Change:
```typescript
const textValue =
  field === 'title'
    ? title
    : field === 'assignee'
      ? assignee
      : field === 'labels'
```

To:
```typescript
const textValue =
  field === 'title'
    ? title
    : field === 'labels'
```

In the `textSetter` chain (lines 396-407), remove the `field === 'assignee'` branch:

Change:
```typescript
const textSetter =
  field === 'title'
    ? setTitle
    : field === 'assignee'
      ? setAssignee
      : field === 'labels'
```

To:
```typescript
const textSetter =
  field === 'title'
    ? setTitle
    : field === 'labels'
```

**Step 5: Update `useInput` isActive condition**

The `useInput` hook currently checks `!editing || !isSelectField` (line 207). The autocomplete component has its own `useInput`, so we need to also suppress the form-level input when editing the assignee field. Change:

```typescript
{ isActive: !editing || !isSelectField },
```

To:

```typescript
{ isActive: !editing || (!isSelectField && currentField !== 'assignee') },
```

**Step 6: Build and verify**

Run: `npm run build`
Expected: PASS — no TypeScript errors

**Step 7: Commit**

```bash
git add src/components/WorkItemForm.tsx
git commit -m "feat(ui): integrate assignee autocomplete into WorkItemForm"
```

---

### Task 8: Run full test suite and lint

**Files:** None (verification only)

**Step 1: Run all tests**

Run: `npm test`
Expected: All tests PASS

**Step 2: Run lint**

Run: `npm run lint`
Expected: No errors

**Step 3: Run format check**

Run: `npm run format:check`
Expected: All matched files use Prettier code style

**Step 4: Fix any issues found in steps 1-3**

If lint or format issues, run `npm run lint:fix` and `npm run format` respectively. If test failures, investigate and fix.

**Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: address lint and format issues"
```

(Only if there were fixes to make.)
