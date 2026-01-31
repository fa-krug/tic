# Implement Item — Design

## Overview

Add a "begin implementation" action to the TUI. Pressing `b` on a selected work item creates a git branch (or worktree), copies the item details to the clipboard, and spawns a child shell in the target directory. The TUI suspends while the shell is active and resumes when the user exits.

## User Experience

1. User selects a work item in the list view and presses `b`
2. Branch name is generated: `tic/{id}-{slugified-title}` (e.g. `tic/42-add-user-authentication`)
3. Based on `branchMode` config:
   - **worktree** (default): creates a git worktree at `.worktrees/{id}-{slugified-title}`, checking out the new branch there
   - **branch**: creates and checks out the branch directly in the current repo
4. Full item details are copied to clipboard as markdown
5. TUI suspends and a child shell spawns in the target directory
6. User sees: `Working on #42: Add user authentication. Exit shell to return to tic.`
7. When the user types `exit`, the shell closes and the TUI resumes

If the branch/worktree already exists (previously started), it resumes — skips creation, opens the shell in the right place, shows `Resuming work on #42`.

## Configuration

Single new field in `.tic/config.yml`:

```yaml
branchMode: worktree   # "worktree" (default) | "branch"
```

## Scope: TUI-Level Feature

This is a developer workflow concern, not a backend CRUD concern. It does not belong in the `Backend` interface or `BackendCapabilities`.

The `b` keybinding only appears and works when:
- A `.git` directory exists in the project root
- The feature is independent of which backend is active

## Architecture

### `src/git.ts` — Git operations

Encapsulates all git commands:

- `isGitRepo(root: string): boolean` — checks for `.git` directory
- `branchExists(name: string): boolean` — `git rev-parse --verify {name}`
- `createBranch(name: string): void` — `git branch {name}`
- `checkoutBranch(name: string): void` — `git checkout {name}`
- `createWorktree(path: string, branch: string): void` — `git worktree add {path} -b {branch}` (or without `-b` if branch exists)
- `worktreeExists(path: string): boolean` — checks if path exists and is a valid worktree
- `hasUncommittedChanges(): boolean` — `git status --porcelain`
- `slugify(id: number, title: string): string` — produces `42-add-user-authentication`

All commands use `execFileSync` (not `exec`) to prevent command injection, consistent with the existing `gh.ts` wrapper.

### `src/implement.ts` — Orchestration

Single entry point:

```typescript
beginImplementation(
  item: WorkItem,
  comments: Comment[],
  config: { branchMode: 'worktree' | 'branch' },
  repoRoot: string
): { resumed: boolean }
```

Steps:
1. Generate branch name `tic/{slug}`
2. Check if branch/worktree already exists (resume case)
3. Create branch or worktree as needed
4. Copy item details to clipboard
5. Spawn child shell via `spawnSync(process.env.SHELL || '/bin/sh', { cwd: targetDir, stdio: 'inherit' })`
6. Return control to TUI when shell exits

### `src/implement.ts` — Clipboard formatting

Pure function for testability:

```typescript
formatItemForClipboard(item: WorkItem, comments: Comment[]): string
```

Produces:

```markdown
# #42: Add user authentication

- **Type:** feature
- **Status:** in-progress
- **Assignee:** skrug
- **Labels:** backend, security
- **Parent:** #10
- **Depends on:** #38, #41

## Description

Users should be able to log in with email and password.
OAuth support can come later.

## Comments

**skrug** (2026-01-30):
Let's use bcrypt for password hashing.
```

Empty/null fields are omitted from output.

### `WorkItemList.tsx` — Keybinding

The `b` key handler:
1. Checks `isGitRepo()` — if false, shows brief warning or does nothing
2. Reads `branchMode` from config (default: `worktree`)
3. In branch mode, checks for uncommitted changes first
4. Calls `beginImplementation()`
5. Triggers refresh on return

The `b` hint only shows in the footer when git is available.

## Error Handling

| Scenario | Behavior |
|---|---|
| Dirty working directory (branch mode) | Warning: `Cannot switch branches — uncommitted changes. Commit or stash first.` |
| Branch/worktree already exists | Resume: skip creation, open shell, show `Resuming work on #42` |
| Clipboard failure (`pbcopy`/`xclip` unavailable) | Non-fatal warning: `Could not copy to clipboard`. Shell still spawns. |
| No git repo | `b` key is ignored. Hint hidden from footer. |
| Shell selection | Uses `process.env.SHELL`, falls back to `/bin/sh` |

## Clipboard Utilities

- macOS: `pbcopy`
- Linux: `xclip -selection clipboard` or `xsel --clipboard`
- Fallback: warn and continue

Detection at startup or first use, not per-invocation.
