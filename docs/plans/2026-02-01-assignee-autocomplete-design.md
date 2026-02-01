# Assignee Autocomplete Design

## Problem

The assignee field in the TUI form is a free-text input. Users must know the exact username or display name for each backend. There is no discovery of available team members and no protection against typos.

## Solution

Add a filter-as-you-type autocomplete to the assignee field in the WorkItemForm. Each backend provides a list of available assignees. The autocomplete suggests matches but allows free-form entry for names not in the list.

## Backend Interface

Add `getAssignees()` to the `Backend` interface in `src/backends/types.ts`:

```typescript
getAssignees(): Promise<string[]>;
```

Returns assignee strings in whatever format the backend already uses for the `assignee` field. No new capability flag needed since all backends support assignee.

### Per-backend implementation

| Backend | Source | Command / Method |
|---------|--------|-----------------|
| GitHub | Repository collaborators | `gh api repos/{owner}/{repo}/collaborators` -> `login` |
| GitLab | Project members | `glab api projects/:id/members/all` -> `username` |
| Azure DevOps | Team members | `az devops team list-members` -> `displayName` |
| Local | Existing items | Scan `.tic/items/*.md`, collect unique non-empty `assignee` values |

All implementations return an empty array on error or when no members are found.

## AutocompleteInput Component

New reusable component at `src/components/AutocompleteInput.tsx`.

### Props

| Prop | Type | Description |
|------|------|-------------|
| `value` | `string` | Current input text |
| `onChange` | `(value: string) => void` | Text change handler |
| `onSubmit` | `() => void` | Confirm selection |
| `suggestions` | `string[]` | Full list of options |
| `focus` | `boolean` | Whether the input is active |

### Behavior

- Renders a `TextInput` for typing.
- Below the input, shows a filtered list of suggestions matching the current text (case-insensitive substring match).
- Arrow up/down navigates the highlighted suggestion.
- Enter on a highlighted suggestion fills the input with that value and calls `onSubmit`.
- Enter with no suggestion highlighted submits the current free-form text.
- Visible suggestions capped at 5 items to avoid terminal overflow.
- Empty input shows the full list (up to the cap) for discovery.
- No matches hides the suggestion list entirely.

### Dependencies

Uses existing Ink primitives only: `TextInput` (from `ink-text-input`), `Box`, `Text`. No new dependencies.

## WorkItemForm Integration

In `src/components/WorkItemForm.tsx`:

### Data loading

- Call `getAssignees()` in the existing `useEffect` that fetches types, statuses, and iterations on mount.
- Store result in `const [assignees, setAssignees] = useState<string[]>([])`.

### Field rendering

- Move `assignee` out of the generic text field rendering path.
- When `assignee` is the active field and editing, render `<AutocompleteInput>` instead of `<TextInput>`.
- When not editing, display the current value as static text (unchanged from today).
- Check `field === 'assignee'` in render logic to branch to the autocomplete component. No general "autocomplete fields" abstraction needed yet.

### No changes to

- Form submission logic (assignee remains a string).
- CLI commands (free-form text input).
- MCP tools (accept any string).

## Testing

### AutocompleteInput component tests (`src/components/AutocompleteInput.test.tsx`)

- Renders suggestions matching input text.
- Filters suggestions case-insensitively.
- Arrow keys navigate the highlighted item.
- Enter on highlighted suggestion fills value and submits.
- Enter with no highlight submits free-form text.
- Shows max 5 suggestions.
- Empty input shows the full list (up to cap).
- No matches shows no suggestion list.

### Backend getAssignees() tests (in each backend's existing test file)

- Returns parsed usernames/display names from CLI output.
- Returns empty array on error or no members.
- Local backend returns unique assignees from existing items.
