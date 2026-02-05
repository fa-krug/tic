# Auto-Update & Version Check Design

## Overview

Add automatic version checking and self-update capability to tic. On every launch, tic asynchronously checks the npm registry for a newer version and displays a footer banner if one is available. The Settings screen gets a new "Updates" section with version info, a manual check action, an update action, and a toggle to disable auto-checking.

## Version Check Service

New module `src/update-checker.ts`:

- **`checkForUpdate(): Promise<UpdateInfo | null>`** fetches `https://registry.npmjs.org/@sascha384/tic/latest` using Node's built-in `fetch`.
- Parses JSON response for the `version` field, compares against current `VERSION` using `semver.gt()`.
- Returns `{ current: string, latest: string, updateAvailable: boolean }` or `null` on any error.
- Uses `AbortController` with ~5s timeout so it never hangs.
- Errors are silently swallowed — a failed check never affects user experience.
- No caching or throttling. Straightforward fetch every time.

### Dependencies

- Add `semver` as a direct dependency for reliable version comparison.

## Async Launch Check & Footer Banner

### Launch integration (`src/app.tsx`)

- On mount, if `autoUpdate` is enabled in config (defaults to `true`), fire `checkForUpdate()` in a `useEffect`.
- Store result in AppContext state: `updateInfo: UpdateInfo | null`.
- App renders immediately; banner appears once the check resolves (~1-2s after launch).

### Footer banner (`src/components/WorkItemList.tsx`)

- When `updateInfo?.updateAvailable` is truthy, render a one-line banner below the list:
  ```
  Update available: 1.14.0 → 1.15.0  Press , to update in Settings
  ```
- Yellow/dim styling — noticeable but not distracting.
- Sits below the list content, outside the scrollable area.

### Config addition

- New field `autoUpdate: boolean` in `.tic/config.yml`, defaults to `true`.
- When `false`, the launch check is skipped. User can still check manually from Settings.

## Updates Section in Settings

New section added to `src/components/Settings.tsx`, below existing backend/template sections:

| Row | Type | Behavior |
|-----|------|----------|
| **Current version** | Read-only | Always shows `Current: v1.14.0` |
| **Latest version** | Read-only | Shows `Latest: checking...` → `Latest: v1.15.0` or `Latest: v1.14.0 (up to date)` |
| **Update now** | Action | Only visible when update available. Enter triggers exit-and-update flow |
| **Check for updates** | Action | Always visible. Enter runs `checkForUpdate()` and updates display |
| **Auto-check on launch** | Toggle | Shows `on/off`. Enter toggles. Writes `autoUpdate` to config |

Section header ("Updates") is non-selectable, consistent with existing template header behavior. Rows integrate into the existing cursor-based navigation.

## Exit-and-Relaunch Update Flow

When the user selects "Update now":

1. Tic cleanly exits the Ink renderer.
2. Spawns a detached updater process (`dist/updater.js`) with `{ stdio: 'inherit', detached: true }`, then calls `process.exit(0)`.
3. The updater script:
   - Runs `npm install -g @sascha384/tic@latest` with inherited stdio so the user sees npm output.
   - On success: relaunches `tic` with the original `process.argv.slice(2)`.
   - On failure: prints the npm error and a fallback message (`Update failed. Run manually: npm install -g @sascha384/tic@latest`), then exits.

### Why a separate script?

The current tic process can't update itself while running — dist files get replaced during `npm install -g`. By handing off to a small updater and exiting first, we avoid file-in-use issues.

### Implementation

- New file `src/updater.ts` compiled to `dist/updater.js`.
- Receives original CLI args as arguments from the spawning process.
- Uses `child_process.execSync` or `spawn` for the npm install, then `spawn` for relaunch.

## Error Handling & Edge Cases

- **Network failures:** `checkForUpdate()` returns `null`. No banner, no error. App behaves as if the feature doesn't exist when offline.
- **Permission errors during update:** Updater script prints npm error output and the fallback command. User sees exactly what went wrong.
- **Version comparison:** `semver.gt(latest, current)` handles pre-release versions correctly.
- **Registry response:** Only reads `response.json().version`. Unexpected response shape treated as failed check (returns `null`).
- **Config migration:** Existing `.tic/config.yml` files without `autoUpdate` default to `true` — existing users get the feature automatically.
- **Multiple instances:** Not a concern — check is read-only, update is user-initiated. npm handles concurrent installs gracefully.
