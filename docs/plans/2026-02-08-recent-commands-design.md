# Recent Commands in Command Palette

## Problem

The command palette (`:`) doesn't remember previously used commands. Users must re-find commands every time.

## Design

### Data Model & Storage

Recent command IDs stored in `.tic/recent-commands.json`:

```json
["create", "edit", "sync", "toggle-detail", "switch-Bug"]
```

- Array of command ID strings, most recent first
- Max 5 entries
- On command select: prepend ID, deduplicate, trim to 5
- `.tic/` is already gitignored

### Store

New Zustand vanilla store `recentCommandsStore` in `src/stores/recentCommandsStore.ts`:

- `recentIds: string[]` — ordered list of recent command IDs
- `init(root: string)` — reads from disk; missing/corrupted file falls back to empty array
- `addRecent(id: string)` — prepends, dedupes, trims to 5, async writes to disk
- `destroy()` — resets state

TUI-only. CLI and MCP don't use the command palette, so they skip this store.

No file watching needed — only the current process writes to the file.

### Command Palette Integration

When the palette opens in `WorkItemList`:

1. Read `recentIds` from store
2. For each recent ID that exists in current `paletteCommands` (respecting `when` context), create a duplicate `OverlayItem` with `category: 'Recent'`
3. Prepend Recent items before existing items
4. After `handleCommandSelect(cmd)`, call `addRecent(cmd.id)`

`groupByCategory` in `OverlayPanel` preserves insertion order, so "Recent" appears first naturally.

When the user types, `filterItems` filters across all items including Recent duplicates — they blend into results. No special hide logic needed.

Duplicates are kept in normal categories below Recent.

### Stale IDs

Command IDs that no longer exist (renamed/removed commands) are silently skipped when building Recent items. They naturally age out as new commands are used. No cleanup logic needed.

### No Changes to OverlayPanel

The existing `OverlayPanel` component already supports categories and grouping. No modifications required.

## Testing

### Store unit tests (`recentCommandsStore.test.ts`)

- `addRecent` prepends, deduplicates, trims to 5
- `init` reads from disk correctly
- `init` handles missing file (empty array)
- `init` handles corrupted JSON (empty array)
- `addRecent` writes to disk
- `destroy` resets state

### Integration

- Recent items appear with "Recent" category when query is empty
- Recent items respect `when` context filtering
- Selecting a command records it to recents

## Implementation Steps

1. Create `recentCommandsStore` with init/addRecent/destroy
2. Write store unit tests
3. Wire store init/destroy into TUI app lifecycle
4. Build Recent items in WorkItemList command palette setup
5. Call `addRecent` on command select
6. Verify integration manually
