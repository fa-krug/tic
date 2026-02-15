# Branch Management Screen Design

## Overview

A dedicated `BranchList` screen (accessed via `B` from WorkItemList) providing full branch lifecycle management: list, create, switch, merge, delete, push. Shows all branches with tic-linked items highlighted, worktree status, and remote ahead/behind counts.

## Data Layer — `src/git.ts` Extensions

No new SQLite tables. Branch data is ephemeral — read from git on screen open and refreshed after actions.

### New git utility functions

- `listBranches()` → `BranchInfo[]` — runs `git branch -vv --format=...` to get:
  - `name`: branch name
  - `current`: boolean (is HEAD)
  - `upstream`: remote tracking branch or null
  - `ahead` / `behind`: number (from `git for-each-ref --format='%(upstream:track)'`)
  - `lastCommit`: short hash + date
- `listWorktrees()` → `WorktreeInfo[]` — runs `git worktree list --porcelain` to get path, branch, HEAD
- `deleteBranch(name, force?)` — `git branch -d` / `-D`
- `mergeBranch(name)` — `git merge <name>` (returns merge result/conflict info)
- `removeWorktree(path, force?)` — `git worktree remove`
- `pushBranch(name)` — `git push -u origin <name>`

### Branch-to-item linking

Match `tic/{id}-*` pattern against item IDs in `backendDataStore`. Resolved at render time, no DB table needed.

## Performance — Two-Phase Loading with Auto-Fetch

1. **Instant first render** — `git branch --format` + `git worktree list --porcelain` are fast (local-only). Show branch names, current branch, worktree status immediately.
2. **Background fetch** — Kick off `git fetch --all --prune` on screen open. Show "Fetching..." indicator in header.
3. **Async remote status** — After fetch completes, query ahead/behind counts via `git for-each-ref --format='%(upstream:track)'` (single command for all branches). Update display.
4. **Cache within session** — Cache branch list in component state. Re-query git only after an action (delete, merge, switch) or manual refresh (`r`).

## UI — `BranchList` Component

### Table columns (responsive, hiding right-to-left on narrow terminals)

| Column | Example | Notes |
|--------|---------|-------|
| Branch | `* tic/42-add-login` | `*` prefix for current, `tic/` branches highlighted with accent color |
| Item | `#42 Add login page` | Linked work item (matched by ID in branch name), dimmed if none |
| Worktree | `/path/to/worktree` | Path if exists, empty if not |
| Remote | `↑2 ↓1` | Ahead/behind counts, `--` if no upstream, `...` while fetching |
| Last Commit | `3h ago` | Relative time of last commit on branch |

### Keybindings

| Key | Action |
|-----|--------|
| `j`/`k` / arrows | Navigate |
| `Enter` | Switch to branch (checkout) |
| `w` | Open shell in worktree (if branch has one) |
| `p` | Create PR for selected branch (reuse existing flow) |
| `m` | Merge selected branch into current branch |
| `d` | Delete branch (+ worktree cleanup with confirmation) |
| `P` | Push branch to remote |
| `r` | Refresh (re-fetch + reload) |
| `n` | New branch (prompt for name) |
| `/` | Filter/search branches |
| `Esc` | Return to list |
| `?` | Help screen |

### Confirmation overlays

- **Delete:** "Delete branch `foo`? This will also remove its worktree at `/path`." (only mentions worktree if one exists). Auto-cleans up worktree on confirm.
- **Merge:** "Merge `foo` into `bar` (current branch)?"
- **Force delete:** If branch is unmerged, confirm with force-delete option.

### Error handling

- Checkout with uncommitted changes → warning toast with suggestion to stash
- Delete current branch → warning "Cannot delete current branch"
- Merge conflicts → toast with "Merge conflicts — resolve in terminal" and option to open shell
- Unmerged branch delete → confirm with force-delete option

### Post-merge flow

After successful merge, offer to delete the merged branch (with worktree cleanup). Show toast on success.

## Integration

### Navigation

- Add `'branch-list'` to the `Screen` type union in `navigationStore.ts`
- `B` in WorkItemList calls `navigate('branch-list')` (gated on `gitAvailable`)
- Lazy-load `BranchList` in `app.tsx` via React Suspense

### Header & Help

- Show "Branches" in breadcrumb area when on branch-list screen
- Add `B` to WorkItemList keybinding reference in HelpScreen
- Add branch-list context keybindings to HelpScreen

### No backend/capabilities gating

Unlike PRs which require `isPrBackend()`, branches are always available when `gitAvailable` is true.

### PR creation

When pressing `p` on a branch, set the source branch context and invoke the existing quick-PR flow. If the branch has a linked item, pre-populate the PR description.

### No new stores

Branch data lives in component state (fetched from git, refreshed after actions). No Zustand store needed.

## CLI — `tic branch` Command Group

| Command | Description |
|---------|-------------|
| `tic branch list` | List branches (table format, `--json` for structured output) |
| `tic branch switch <name>` | Checkout branch |
| `tic branch create <name>` | Create new branch |
| `tic branch delete <name>` | Delete branch (+ worktree), `--force` flag |
| `tic branch merge <name>` | Merge into current branch |
| `tic branch push [name]` | Push to remote (defaults to current branch) |

All commands respect `--json` and `--quiet` global flags.

## MCP Tools

Always registered, gated on `gitAvailable` at runtime:

| Tool | Description |
|------|-------------|
| `tic-list_branches` | List branches with item links, worktree, remote status |
| `tic-switch_branch` | Checkout a branch |
| `tic-create_branch` | Create a new branch |
| `tic-delete_branch` | Delete branch (+ worktree cleanup) |
| `tic-merge_branch` | Merge branch into current |
| `tic-push_branch` | Push branch to remote |

## Shared Logic

Git functions in `src/git.ts` serve all three surfaces (TUI, CLI, MCP). Branch-to-item linking logic (matching `tic/{id}-*`) in a shared helper.
