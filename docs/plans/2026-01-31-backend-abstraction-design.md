# Backend Abstraction & Switching Design

## Goal

Encapsulate backend access behind a factory pattern so adding new backends (GitHub, GitLab, Azure DevOps) is straightforward. Auto-detect the appropriate backend during `tic init`, store the choice in project config, and expose backend switching via TUI settings screen, CLI commands, and MCP tool.

## Current State

The `Backend` interface in `src/backends/types.ts` is already clean and well-abstracted. All components and CLI commands use only the interface — zero leakage of `LocalBackend` specifics. The gap is that backend instantiation is hardcoded to `LocalBackend` in three places: TUI entry, CLI helper, and MCP proxy.

## Design

### 1. Backend Factory (`src/backends/factory.ts`)

New file with two exports:

**`detectBackend(root: string): string`**
- Runs `git remote -v` and inspects URLs
- `github.com` in remote URL -> `"github"`
- `gitlab.com` in remote URL -> `"gitlab"`
- `dev.azure.com` in remote URL -> `"azure"`
- No remote or no match -> `"local"`
- Only detects well-known hosts (no self-hosted support)

**`createBackend(root: string): Backend`**
- Reads `backend` field from `.tic/config.yml`
- `"local"` -> `new LocalBackend(root)`
- `"github"` / `"gitlab"` / `"azure"` -> throws "not yet implemented" error
- Unknown value -> throws validation error

### 2. Config Changes

Add `backend` field to `.tic/config.yml`:

```yaml
backend: local    # local | github | gitlab | azure
types:
  - epic
  - issue
  - task
statuses:
  - backlog
  - todo
  - in-progress
  - review
  - done
# ... rest of config
```

**`src/backends/local/config.ts`**: Add `backend: string` to the `Config` interface with default value `'local'`.

### 3. Init Flow Changes (`src/cli/commands/init.ts`)

After creating the `.tic/` directory:
1. Call `detectBackend(root)` to get a suggested default
2. Prompt the user with all backend options, pre-selecting the detected one
3. Write the chosen value into `.tic/config.yml` as the `backend` field

The prompt always appears — auto-detection only sets the default selection.

### 4. Wiring Changes

Replace all hardcoded `new LocalBackend(root)` with `createBackend(root)`:

- **`src/index.tsx`** — TUI entry point
- **`src/cli/index.ts`** — `createBackend()` helper function
- **`src/cli/commands/mcp.ts`** — lazy proxy initialization

### 5. CLI Commands (`src/cli/index.ts`)

Add generic config commands:

- **`tic config get <key>`** — reads a value from `.tic/config.yml` and prints it
- **`tic config set <key> <value>`** — writes a value. For `backend`, validates against the known list (`local`, `github`, `gitlab`, `azure`). For other keys, writes as-is.

### 6. TUI Settings Screen (`src/components/Settings.tsx`)

New screen accessible via `,` from the work item list.

**Layout:**
- **Backend selector** — list of backends with current one highlighted. Arrow keys to navigate, Enter to select. Non-implemented backends show "(not yet available)" inline.
- **Project config (read-only)** — displays current types, statuses, iterations, and current iteration.

**Navigation:** `Esc` or `,` to return to list screen.

**Routing:** Add `settings` to the screen union type in `src/app.tsx`.

**Key binding:** Add `,` handler in `WorkItemList.tsx` to navigate to settings.

### 7. MCP Changes (`src/cli/commands/mcp.ts`)

- **`set_backend` tool** — takes a `backend` string, validates against known list, updates config
- **`get_config` tool** — already returns full config; will naturally include `backend` once it's in the config schema

## Files Changed

| File | Change |
|------|--------|
| `src/backends/factory.ts` | **New** — `createBackend()` and `detectBackend()` |
| `src/components/Settings.tsx` | **New** — TUI settings screen |
| `src/backends/local/config.ts` | Add `backend` field to Config interface and default |
| `src/cli/commands/init.ts` | Prompt for backend with auto-detected default |
| `src/cli/index.ts` | Add `config get/set` commands, use factory |
| `src/index.tsx` | Use factory for TUI backend creation |
| `src/cli/commands/mcp.ts` | Use factory in proxy, add `set_backend` tool |
| `src/app.tsx` | Add `settings` screen to routing |
| `src/components/WorkItemList.tsx` | Add `,` key binding for settings |

## Out of Scope

- Actual GitHub, GitLab, Azure DevOps backend implementations (just the factory slot)
- Migration between backends
- Self-hosted host detection
- User-level (non-project) settings
