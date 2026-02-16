# matchesCommand Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace hardcoded key strings in `useInput()` handlers with `matchesCommand(id, input, key)` calls that look up keys from the command registry.

**Architecture:** Add a `keys` field (machine-readable key descriptors) to `Command` alongside the existing `shortcut` field (display-only). A `matchesCommand()` function resolves a command ID to its key descriptors and checks if the current input matches. Components mechanically replace `input === 'x'` / `key.special` with `matchesCommand('cmd-id', input, key)`.

**Tech Stack:** TypeScript, Ink `useInput` key type

---

### Task 1: Add `KeyDescriptor` type and `matchesCommand()` to commands.ts

**Files:**
- Modify: `src/commands.ts`
- Modify: `src/commands.test.ts`

**Step 1: Write failing tests for `matchesCommand`**

Add to `src/commands.test.ts`:

```ts
import {
  // ... existing imports ...
  matchesCommand,
} from './commands.js';

describe('matchesCommand', () => {
  const noKey = {
    upArrow: false, downArrow: false, leftArrow: false, rightArrow: false,
    pageDown: false, pageUp: false, home: false, end: false,
    return: false, escape: false, ctrl: false, shift: false,
    tab: false, backspace: false, delete: false, meta: false,
  };

  it('matches a single character key', () => {
    expect(matchesCommand('create', 'c', noKey)).toBe(true);
    expect(matchesCommand('create', 'd', noKey)).toBe(false);
  });

  it('matches a special key', () => {
    expect(matchesCommand('edit', '', { ...noKey, return: true })).toBe(true);
    expect(matchesCommand('edit', '', noKey)).toBe(false);
  });

  it('matches a modifier + special key', () => {
    expect(matchesCommand('list-range-select', '', { ...noKey, upArrow: true, shift: true })).toBe(true);
    expect(matchesCommand('list-range-select', '', { ...noKey, upArrow: true })).toBe(false);
  });

  it('matches any of multiple keys', () => {
    // pr-open has keys: ['o', { special: 'return' }]
    expect(matchesCommand('pr-open', 'o', noKey)).toBe(true);
    expect(matchesCommand('pr-open', '', { ...noKey, return: true })).toBe(true);
    expect(matchesCommand('pr-open', 'x', noKey)).toBe(false);
  });

  it('returns false for unknown command', () => {
    expect(matchesCommand('nonexistent', 'c', noKey)).toBe(false);
  });

  it('returns false for command without keys', () => {
    // save-view has no keys
    expect(matchesCommand('save-view', 's', noKey)).toBe(false);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/commands.test.ts`
Expected: FAIL — `matchesCommand` not exported

**Step 3: Add `KeyDescriptor` type and `keys` field to Command interface**

In `src/commands.ts`, after the existing imports, add:

```ts
export type KeyDescriptor =
  | string
  | { special: string; modifier?: 'shift' };
```

Add `keys` to the `Command` interface:

```ts
export interface Command {
  id: string;
  label: string;
  category: CommandCategory;
  shortcut?: string;
  keys?: KeyDescriptor[];
  screen: Screen | Screen[] | 'global';
  helpGroup?: string;
  footer?: boolean;
  footerLabel?: string;
  when?: (ctx: CommandContext) => boolean;
}
```

**Step 4: Add `keys` to every command that has a corresponding keyboard handler**

This is the bulk of the work. Every command that a component's `useInput` handler checks for needs a `keys` entry. Here is the complete mapping:

**List screen commands:**
- `create`: `keys: ['c']`
- `edit`: `keys: [{ special: 'return' }]`
- `delete`: `keys: ['d']`
- `open`: `keys: ['o']`
- `branch`: `keys: ['b']`
- `sync`: `keys: ['r']`
- `sort`: `keys: ['O']`
- `iterations`: `keys: ['i']`
- `settings`: `keys: [',']`
- `status`: `keys: ['S']`
- `help`: `keys: ['?']`
- `mark`: `keys: ['m']`
- `clear-marks`: `keys: ['M']`
- `set-priority`: `keys: ['y']` (also add `shortcut: 'y'`)
- `set-assignee`: `keys: ['a']`
- `set-labels`: `keys: ['l']`
- `set-type`: `keys: ['t']`
- `bulk-menu`: `keys: ['x']`
- `filter`: `keys: ['F']`
- `clear-filters`: `keys: ['X']`
- `load-view`: `keys: ['V']`
- `list-navigate`: `keys: [{ special: 'upArrow' }, { special: 'downArrow' }]`
- `list-page`: `keys: [{ special: 'pageUp' }, { special: 'pageDown' }]`
- `list-home-end`: `keys: [{ special: 'home' }, { special: 'end' }]`
- `list-collapse`: `keys: [{ special: 'leftArrow' }]`
- `list-expand`: `keys: [{ special: 'rightArrow' }]`
- `list-undo`: `keys: ['u']`
- `list-status`: `keys: ['s']`
- `list-parent`: `keys: ['g']`
- `list-pr-create`: `keys: ['p']`
- `list-pr-list`: `keys: ['P']`
- `list-branch-manage`: `keys: ['B']`
- `list-range-select`: `keys: [{ special: 'upArrow', modifier: 'shift' }, { special: 'downArrow', modifier: 'shift' }]`
- `list-tab`: `keys: [{ special: 'tab' }]`
- `list-toggle-description`: `keys: [' ']`
- `list-command-bar`: `keys: ['/']`
- `quit`: `keys: ['q']`
- `toggle-detail-panel`: `keys: ['v']`

**Branch list commands:**
- `nav-back`: `keys: [{ special: 'escape' }]`
- `branch-navigate`: `keys: [{ special: 'upArrow' }, { special: 'downArrow' }]`
- `branch-search`: `keys: ['/']`
- `branch-switch`: `keys: [{ special: 'return' }]`
- `branch-create`: `keys: ['c']`
- `branch-delete`: `keys: ['d']`
- `branch-merge`: `keys: ['m']`
- `branch-push`: `keys: ['P']`
- `branch-create-pr`: `keys: ['p']`
- `branch-worktree`: `keys: ['w']`
- `branch-refresh`: `keys: ['r']`

**PR list commands:**
- `pr-navigate`: `keys: [{ special: 'upArrow' }, { special: 'downArrow' }]`
- `pr-open`: `keys: ['o', { special: 'return' }]`
- `pr-search`: `keys: ['/']`

**Form commands:**
- `form-navigate`: `keys: [{ special: 'upArrow' }, { special: 'downArrow' }]`
- `form-edit`: `keys: [{ special: 'return' }]`
- `form-revert`: `keys: [{ special: 'escape' }]`
- `form-save`: `keys: ['s']`
- `form-back`: `keys: [{ special: 'escape' }]`

**Settings commands:**
- `settings-navigate`: `keys: [{ special: 'upArrow' }, { special: 'downArrow' }]`
- `settings-select`: `keys: [{ special: 'return' }]`
- `settings-back`: `keys: [{ special: 'escape' }, ',']`
- `settings-create-template`: `keys: ['c']`
- `settings-delete-template`: `keys: ['d']`
- `settings-edit-template`: `keys: [{ special: 'return' }]`

**Iteration picker commands:**
- `iter-navigate`: `keys: [{ special: 'upArrow' }, { special: 'downArrow' }]`
- `iter-select`: `keys: [{ special: 'return' }]`

**Status screen commands:**
- `status-scroll`: `keys: [{ special: 'upArrow' }, { special: 'downArrow' }]`
- `status-back`: `keys: [{ special: 'escape' }, 'q']`
- `status-retry`: `keys: ['r']`

**Help screen commands (need new entries):**
- Add new command `help-scroll` with `keys: [{ special: 'upArrow' }, { special: 'downArrow' }]`, `screen: 'help'`, `helpGroup: 'Navigation'`
- Add new command `help-back` with `keys: [{ special: 'escape' }]`, `screen: 'help'`, `helpGroup: 'Navigation'`

**Step 5: Implement `matchesCommand` function**

Add to `src/commands.ts`:

```ts
export function matchesCommand(
  id: string,
  input: string,
  key: Record<string, boolean>,
): boolean {
  const cmd = findCommand(id);
  if (!cmd?.keys) return false;
  return cmd.keys.some((k) => {
    if (typeof k === 'string') return input === k;
    if (k.modifier === 'shift') return key[k.special] && key.shift;
    return key[k.special] && !key.shift;
  });
}
```

Note the `!key.shift` guard on non-modifier specials — this prevents `shift+upArrow` from matching `list-navigate` (it should only match `list-range-select`).

**Step 6: Run tests to verify they pass**

Run: `npx vitest run src/commands.test.ts`
Expected: PASS

**Step 7: Add parity test — every command with `keys` has matching `shortcut`**

```ts
it('every command with keys also has a shortcut for display', () => {
  const allCmds = getVisibleCommands(makeContext());
  const withKeys = allCmds.filter(c => c.keys && c.keys.length > 0);
  for (const cmd of withKeys) {
    expect(cmd.shortcut, `${cmd.id} has keys but no shortcut`).toBeDefined();
  }
});
```

**Step 8: Run full test suite**

Run: `npx vitest run src/commands.test.ts`
Expected: PASS

**Step 9: Run build, lint, format check**

Run: `npm run build && npm run lint && npm run format:check`
Expected: All pass

**Step 10: Commit**

```
feat: add KeyDescriptor type and matchesCommand() to command registry
```

---

### Task 2: Migrate WorkItemList.tsx to matchesCommand

**Files:**
- Modify: `src/components/WorkItemList.tsx`

**Step 1: Import `matchesCommand` at top of file**

Add to existing imports from `'../commands.js'`:

```ts
import { matchesCommand } from '../commands.js';
```

**Step 2: Replace all hardcoded key checks in Handler 1 (description scroll)**

Replace in the description scroll `useInput` handler (~lines 592-611):

```
input === ' '  →  matchesCommand('list-toggle-description', input, key)
key.escape     →  matchesCommand('list-toggle-description', input, key)  // same command closes it
key.upArrow    →  (keep as-is — scroll is internal UI, not a command)
key.downArrow  →  (keep as-is — scroll is internal UI, not a command)
```

Wait — the description scroll up/down is internal widget behavior (scrolling within a text view), not a registered command. Keep those as `key.upArrow`/`key.downArrow`. Only replace the toggle-off keys.

Actually, looking more carefully: `key.escape` in this handler closes the description overlay — it's not the same as `list-toggle-description` (which is `space`). The escape here is more of an "exit overlay" action. Since this is an internal UI pattern (like OverlayPanel), keep escape as-is. Only replace `input === ' '`.

**Step 3: Replace all hardcoded key checks in Handler 2 (main list input)**

Mechanical replacements — every `input === 'X'` becomes `matchesCommand('cmd-id', input, key)`:

| Before | After |
|--------|-------|
| `input === '/'` | `matchesCommand('list-command-bar', input, key)` |
| `input === '?'` | `matchesCommand('help', input, key)` |
| `input === 'q'` | `matchesCommand('quit', input, key)` |
| `input === 'i'` | `matchesCommand('iterations', input, key)` |
| `input === 'P'` (PR list) | `matchesCommand('list-pr-list', input, key)` |
| `input === 'B'` | `matchesCommand('list-branch-manage', input, key)` |
| `input === ','` | `matchesCommand('settings', input, key)` |
| `input === 'c'` | `matchesCommand('create', input, key)` |
| `input === 'd'` | `matchesCommand('delete', input, key)` |
| `input === 'u'` | `matchesCommand('list-undo', input, key)` |
| `input === 'o'` | `matchesCommand('open', input, key)` |
| `input === 'b'` | `matchesCommand('branch', input, key)` |
| `input === 'S'` | `matchesCommand('status', input, key)` |
| `input === 'O'` | `matchesCommand('sort', input, key)` |
| `input === 'F'` | `matchesCommand('filter', input, key)` |
| `input === 'V'` | `matchesCommand('load-view', input, key)` |
| `input === 'X'` | `matchesCommand('clear-filters', input, key)` |
| `input === 's'` | `matchesCommand('list-status', input, key)` |
| `input === 'v'` | `matchesCommand('toggle-detail-panel', input, key)` |
| `input === ' '` | `matchesCommand('list-toggle-description', input, key)` |
| `input === 'p'` (PR create) | `matchesCommand('list-pr-create', input, key)` |
| `input === 'm'` | `matchesCommand('mark', input, key)` |
| `input === 'M'` | `matchesCommand('clear-marks', input, key)` |
| `input === 'x'` | `matchesCommand('bulk-menu', input, key)` |
| `input === 'y'` | `matchesCommand('set-priority', input, key)` |
| `input === 'g'` | `matchesCommand('list-parent', input, key)` |
| `input === 'a'` | `matchesCommand('set-assignee', input, key)` |
| `input === 'l'` | `matchesCommand('set-labels', input, key)` |
| `input === 't'` | `matchesCommand('set-type', input, key)` |
| `input === 'r'` | `matchesCommand('sync', input, key)` |
| `key.upArrow` (without shift) | `matchesCommand('list-navigate', input, key)` — but only when checking direction. Keep `key.upArrow` for the direction branch (`cursorUp` vs `cursorDown`). See note below. |
| `key.downArrow` (without shift) | Same as above |
| `key.upArrow && key.shift` | `matchesCommand('list-range-select', input, key)` — use `key.upArrow` for direction |
| `key.downArrow && key.shift` | `matchesCommand('list-range-select', input, key)` — use `key.downArrow` for direction |
| `key.pageUp` | `matchesCommand('list-page', input, key)` — use `key.pageUp` for direction |
| `key.pageDown` | `matchesCommand('list-page', input, key)` — use `key.pageDown` for direction |
| `key.home` | `matchesCommand('list-home-end', input, key)` — use `key.home` for direction |
| `key.end` | `matchesCommand('list-home-end', input, key)` — use `key.end` for direction |
| `key.rightArrow` | `matchesCommand('list-expand', input, key)` |
| `key.leftArrow` | `matchesCommand('list-collapse', input, key)` |
| `key.return` | `matchesCommand('edit', input, key)` |
| `key.tab` | `matchesCommand('list-tab', input, key)` |

**Important note on directional commands:** For commands like `list-navigate` where both up and down are the same command but the handler needs to know which direction, the pattern is:

```ts
// Before:
if (key.upArrow) { cursorUp(); return; }
if (key.downArrow) { cursorDown(); return; }

// After:
if (matchesCommand('list-navigate', input, key)) {
  if (key.upArrow) cursorUp();
  else cursorDown();
  return;
}
```

Similarly for `list-range-select`, `list-page`, `list-home-end` — use `matchesCommand` for the command match, then branch on `key.upArrow`/`key.downArrow`/etc. for direction.

**Step 4: Run full test suite**

Run: `npm test`
Expected: All tests pass (behavior is identical)

**Step 5: Run build, lint, format**

Run: `npm run build && npm run lint && npm run format`

**Step 6: Commit**

```
refactor: WorkItemList uses matchesCommand for all key bindings
```

---

### Task 3: Migrate BranchList.tsx to matchesCommand

**Files:**
- Modify: `src/components/BranchList.tsx`

**Step 1: Import `matchesCommand`**

Add to imports from `'../commands.js'`.

**Step 2: Replace hardcoded keys in normal mode handler**

Only replace keys in the `mode === 'normal'` branch. The `mode === 'new-branch'` branch handles text input — leave it as-is.

| Before | After |
|--------|-------|
| `key.escape` | `matchesCommand('nav-back', input, key)` |
| `input === '?'` | `matchesCommand('help', input, key)` |
| `input === '/'` | `matchesCommand('branch-search', input, key)` |
| `key.downArrow` / `key.upArrow` | `matchesCommand('branch-navigate', input, key)` + direction branch |
| `key.return` | `matchesCommand('branch-switch', input, key)` |
| `input === 'w'` | `matchesCommand('branch-worktree', input, key)` |
| `input === 'd'` | `matchesCommand('branch-delete', input, key)` |
| `input === 'm'` | `matchesCommand('branch-merge', input, key)` |
| `input === 'P'` | `matchesCommand('branch-push', input, key)` |
| `input === 'p'` | `matchesCommand('branch-create-pr', input, key)` |
| `input === 'r'` | `matchesCommand('branch-refresh', input, key)` |
| `input === 'c'` | `matchesCommand('branch-create', input, key)` |

Note: `n` key for new branch — check if this is `c` or `n` in the actual code. The command registry says `c` but the CLAUDE.md mentions `n`. Read the actual handler to confirm.

**Step 3: Run tests, build, lint, format**

Run: `npm test && npm run build && npm run lint && npm run format`

**Step 4: Commit**

```
refactor: BranchList uses matchesCommand for all key bindings
```

---

### Task 4: Migrate PullRequestList.tsx to matchesCommand

**Files:**
- Modify: `src/components/PullRequestList.tsx`

**Step 1: Import `matchesCommand`**

**Step 2: Replace hardcoded keys**

| Before | After |
|--------|-------|
| `key.escape` | `matchesCommand('nav-back', input, key)` |
| `input === '?'` | `matchesCommand('help', input, key)` |
| `input === '/'` | `matchesCommand('pr-search', input, key)` |
| `key.downArrow` / `key.upArrow` | `matchesCommand('pr-navigate', input, key)` + direction branch |
| `key.return \|\| input === 'o'` | `matchesCommand('pr-open', input, key)` |

**Step 3: Run tests, build, lint, format**

**Step 4: Commit**

```
refactor: PullRequestList uses matchesCommand for all key bindings
```

---

### Task 5: Migrate WorkItemForm.tsx to matchesCommand

**Files:**
- Modify: `src/components/WorkItemForm.tsx`

**Step 1: Import `matchesCommand`**

**Step 2: Replace hardcoded keys in form handler**

This handler has multiple modes. Only replace keys that map to registered commands:

- In dirty-prompt mode: `input === 's'` → `matchesCommand('form-save', input, key)`. Leave `input === 'd'` (discard) and `key.escape` (cancel prompt) as-is — these are dialog-specific, not commands.
- In normal (non-editing) mode:
  - `key.escape` → `matchesCommand('form-back', input, key)`
  - `key.upArrow` / `key.downArrow` → `matchesCommand('form-navigate', input, key)` + direction branch
  - `key.return` → `matchesCommand('form-edit', input, key)`
- In edit mode:
  - `key.escape` → `matchesCommand('form-revert', input, key)`

**Step 3: Run tests, build, lint, format**

**Step 4: Commit**

```
refactor: WorkItemForm uses matchesCommand for all key bindings
```

---

### Task 6: Migrate Settings.tsx to matchesCommand

**Files:**
- Modify: `src/components/Settings.tsx`

**Step 1: Import `matchesCommand`**

**Step 2: Replace hardcoded keys in main handler**

| Before | After |
|--------|-------|
| `key.escape` | `matchesCommand('settings-back', input, key)` |
| `input === ','` | `matchesCommand('settings-back', input, key)` (same command, both in `keys`) |
| `input === '?'` | `matchesCommand('help', input, key)` |
| `key.upArrow` / `key.downArrow` | `matchesCommand('settings-navigate', input, key)` + direction |
| `key.return` | `matchesCommand('settings-select', input, key)` |
| `input === 'c'` | `matchesCommand('settings-create-template', input, key)` |
| `input === 'd'` | `matchesCommand('settings-delete-template', input, key)` |

Leave the Jira field editing handler (second `useInput`) as-is — it's internal overlay behavior.

**Step 3: Run tests, build, lint, format**

**Step 4: Commit**

```
refactor: Settings uses matchesCommand for all key bindings
```

---

### Task 7: Migrate remaining screens (HelpScreen, IterationPicker, StatusScreen)

**Files:**
- Modify: `src/components/HelpScreen.tsx`
- Modify: `src/components/IterationPicker.tsx`
- Modify: `src/components/StatusScreen.tsx`
- Modify: `src/commands.ts` (add `help-scroll` and `help-back` commands)

**Step 1: Add missing help screen commands to registry**

In `src/commands.ts`, add:

```ts
{
  id: 'help-scroll',
  label: 'Scroll help',
  category: 'Navigation',
  keys: [{ special: 'upArrow' }, { special: 'downArrow' }],
  shortcut: '↑/↓',
  screen: 'help',
  helpGroup: 'Navigation',
},
{
  id: 'help-back',
  label: 'Go back',
  category: 'Navigation',
  keys: [{ special: 'escape' }],
  shortcut: 'esc',
  screen: 'help',
  helpGroup: 'Navigation',
  footer: true,
  footerLabel: 'back',
},
```

**Step 2: Migrate HelpScreen.tsx**

| Before | After |
|--------|-------|
| `key.escape` | `matchesCommand('help-back', input, key)` |
| `key.upArrow` / `key.downArrow` | `matchesCommand('help-scroll', input, key)` + direction |

**Step 3: Migrate IterationPicker.tsx**

| Before | After |
|--------|-------|
| `key.escape` | `matchesCommand('nav-back', input, key)` |
| `input === '?'` | `matchesCommand('help', input, key)` |

Note: Up/down/enter handled by `SelectInput` component — leave those alone.

**Step 4: Migrate StatusScreen.tsx**

| Before | After |
|--------|-------|
| `key.escape \|\| input === 'q'` | `matchesCommand('status-back', input, key)` |
| `input === '?'` | `matchesCommand('help', input, key)` |
| `input === 'r'` | `matchesCommand('status-retry', input, key)` |
| `key.upArrow` / `key.downArrow` | `matchesCommand('status-scroll', input, key)` + direction |

**Step 5: Run full test suite, build, lint, format**

Run: `npm test && npm run build && npm run lint && npm run format`

**Step 6: Commit**

```
refactor: HelpScreen, IterationPicker, StatusScreen use matchesCommand
```

---

### Task 8: Final verification and cleanup

**Files:**
- All modified files

**Step 1: Grep for remaining hardcoded key checks in screen components**

Run: `grep -n "input === '" src/components/WorkItemList.tsx src/components/BranchList.tsx src/components/PullRequestList.tsx src/components/WorkItemForm.tsx src/components/Settings.tsx src/components/HelpScreen.tsx src/components/IterationPicker.tsx src/components/StatusScreen.tsx`

Expected: Only internal/dialog-specific checks remain (dirty prompt `'d'`, new-branch text input, etc.)

**Step 2: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 3: Run build + lint + format check**

Run: `npm run build && npm run lint && npm run format:check`
Expected: All pass

**Step 4: Verify `set-priority` now has shortcut**

Check that the `set-priority` command now has both `keys: ['y']` and `shortcut: 'y'`.

**Step 5: Commit if any cleanup was needed**

```
chore: final cleanup for matchesCommand migration
```
