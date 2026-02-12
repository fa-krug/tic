# Branch Command Setting Design

## Summary

Allow users to configure the command that executes after creating a branch/worktree via the `b` keybinding. The entire post-branch command is configurable, replacing the current hardcoded shell spawn. The default launches Claude Code in interactive mode with a brainstorming prompt about the current issue.

## Motivation

When creating a feature branch for an issue, developers often follow up with the same action (opening an AI coding assistant, running a setup script, opening their editor). Making the post-branch command fully configurable removes friction and keeps the developer in flow.

## Config Changes

Two new fields in `Config` interface (`src/backends/local/config.ts`):

```typescript
branchCommand?: string;    // Command to execute after branch creation
copyToClipboard?: boolean; // Copy item details to clipboard on branch (default: true)
```

### Default Values

```typescript
// in defaultConfig
branchCommand: `bash --init-file <(echo "source ~/.bashrc; claude 'Brainstorm the implementation of issue #$TIC_ITEM_ID: $TIC_ITEM_TITLE. $TIC_ITEM_DESCRIPTION'")`,
copyToClipboard: true,
```

The default launches an interactive Claude session with full issue context. If the command fails (e.g., `claude` not installed), falls back to plain `$SHELL` with a toast warning.

## Environment Variables

All env vars are set before executing `branchCommand`. Commands reference them as standard shell variables (e.g., `$TIC_ITEM_ID`).

| Variable | Source | Example |
|---|---|---|
| `TIC_ITEM_ID` | work item id | `23` |
| `TIC_ITEM_TITLE` | work item title | `Add branch command setting` |
| `TIC_ITEM_DESCRIPTION` | work item description | `## Summary\nAllow users to...` |
| `TIC_ITEM_STATUS` | work item status | `open` |
| `TIC_ITEM_PRIORITY` | work item priority | `medium` |
| `TIC_ITEM_LABELS` | comma-separated labels | `enhancement,settings,workflow` |
| `TIC_ITEM_URL` | remote URL (empty for local) | `https://github.com/org/repo/issues/23` |
| `TIC_BRANCH` | branch name | `tic/23-add-branch-command-setting` |
| `TIC_TARGET_DIR` | working directory | `/path/to/.worktrees/tic/23-add-...` |

## Implementation Changes

### `src/implement.ts`

Refactor `beginImplementation()`:

1. Create branch/worktree (unchanged)
2. Copy to clipboard **only if** `copyToClipboard !== false`
3. Set all env vars listed above
4. Execute `branchCommand` via `execSync(branchCommand, { stdio: 'inherit', cwd: targetDir, env, shell: true })`
5. On failure: fall back to plain `$SHELL`, return a flag so caller can show a toast

The function signature accepts `branchCommand` and `copyToClipboard` from config, plus the full work item data (description, status, priority, labels, url).

### `src/components/WorkItemList.tsx`

- Read `branchCommand` and `copyToClipboard` from config store
- Pass them to `beginImplementation()`
- Show toast warning on fallback

### `src/components/Settings.tsx`

Add a "Branch" section after "Defaults" and before "Templates":

```
Branch
  Branch command: bash --init-file <(echo "source ~/.bashrc; cl...
  Copy to clipboard: on
```

- **Branch command**: opens `$EDITOR` on enter (same pattern as description editing in WorkItemForm), since commands can be long
- **Copy to clipboard**: toggle on enter (like auto-update toggle)
- Display truncates the command to fit terminal width

### `src/components/HelpScreen.tsx`

Document the branch command setting and list all available `TIC_*` environment variables.

## Error Handling

- **Command failure**: catch error, fall back to plain `$SHELL` in target directory, show toast: `"Branch command failed: <error>. Falling back to shell."`
- **Empty `branchCommand`**: treat as "spawn plain shell" (no command)
- **Resume** (`b` on existing branch): runs the branch command again (same behavior as new branch)
- **Branch/worktree already created**: no rollback needed on command failure — the branch is already checked out

## Example Configurations

```yaml
# Default: Claude brainstorming (set automatically)
branchCommand: "bash --init-file <(echo \"source ~/.bashrc; claude 'Brainstorm the implementation of issue #$TIC_ITEM_ID: $TIC_ITEM_TITLE. $TIC_ITEM_DESCRIPTION'\")"

# Plain interactive shell (current behavior)
branchCommand: ""

# Open VS Code
branchCommand: "code . && bash"

# Run a setup script then drop to shell
branchCommand: "bash --init-file <(echo \"source ~/.bashrc; ./scripts/branch-setup.sh\")"

# Claude one-shot then shell
branchCommand: "bash --init-file <(echo \"source ~/.bashrc; claude --print 'Summarize issue #$TIC_ITEM_ID: $TIC_ITEM_TITLE'\")"
```

## Files to Modify

1. **`src/backends/local/config.ts`** — Add `branchCommand` and `copyToClipboard` to `Config` interface and `defaultConfig`
2. **`src/implement.ts`** — Refactor `beginImplementation()` for configurable command, env vars, clipboard toggle
3. **`src/components/WorkItemList.tsx`** — Pass new config values, handle fallback toast
4. **`src/components/Settings.tsx`** — Add "Branch" section with command editor and clipboard toggle
5. **`src/components/HelpScreen.tsx`** — Document setting and env vars
6. **`src/implement.test.ts`** — Update tests for new env vars, clipboard toggle, branch command execution

## Related Issue

tic #23: Add setting for default command to execute when opening a new branch
