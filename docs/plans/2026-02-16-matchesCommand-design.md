# Design: `matchesCommand()` — Replace hardcoded key strings with registry lookups

## Problem

Component `useInput()` handlers hardcode key strings (`input === 'c'`, `key.return`, etc.). This means key bindings are duplicated between `commands.ts` and component handlers — they can drift apart, and changing a key requires updating two places.

## Solution

Add a machine-readable `keys` field to `Command` and a `matchesCommand(id, input, key)` helper. Components replace hardcoded comparisons with `matchesCommand()` calls.

## Key descriptor format

```ts
type KeyDescriptor =
  | string                                      // single char: 'c', '/', '?'
  | { special: keyof Key }                      // special key: { special: 'return' }
  | { special: keyof Key; modifier: 'shift' }   // modified: { special: 'upArrow', modifier: 'shift' }

interface Command {
  // ... existing fields ...
  keys?: KeyDescriptor[];  // machine-readable, used by matchesCommand()
  shortcut?: string;       // human-readable display label (unchanged)
}
```

## `matchesCommand` function

```ts
export function matchesCommand(
  id: string,
  input: string,
  key: { [k: string]: boolean }
): boolean {
  const cmd = findCommand(id);
  if (!cmd?.keys) return false;
  return cmd.keys.some(k => {
    if (typeof k === 'string') return input === k;
    if (k.modifier === 'shift') return key[k.special] && key.shift;
    return key[k.special];
  });
}
```

## Transformation examples

| Before | After |
|--------|-------|
| `input === 'c'` | `matchesCommand('create', input, key)` |
| `key.return` | `matchesCommand('edit', input, key)` |
| `key.escape` | `matchesCommand('nav-back', input, key)` |
| `key.upArrow && key.shift` | `matchesCommand('list-range-select', input, key)` |
| `key.return \|\| input === 'o'` | `matchesCommand('pr-open', input, key)` |

Commands with multiple triggers (e.g., `esc/q`) put both keys in the `keys` array — `matchesCommand` checks if *any* match.

## Scope

**In scope** (8 screen-level components):
- WorkItemList, BranchList, PullRequestList, WorkItemForm, Settings, HelpScreen, IterationPicker, StatusScreen

**Out of scope** (internal widget handlers):
- OverlayPanel, AutocompleteInput, MultiAutocompleteInput — generic UI input, not app-level commands

## What doesn't change

- `shortcut` field stays for help/footer display
- `when()` guards stay for command palette visibility
- Handler logic stays in components (close to React state)
- Guard conditions (capability checks, state checks) remain in the handler's `if` block

## Edge cases

1. **Missing `keys`**: Commands without `keys` (display-only entries) — `matchesCommand` returns false
2. **`set-priority`**: Currently has no shortcut — gets `keys: ['y']` added
3. **Navigation keys across screens**: Each screen's nav command has its own `keys` entries
4. **`help`/`quit` are global**: Each handler still calls `matchesCommand()` independently
