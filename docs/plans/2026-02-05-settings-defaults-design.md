# Settings Defaults Design

## Overview

Refactor the Settings screen to replace the read-only "Project Config" display with editable default settings: default item type and default iteration. These defaults control the initial filter state of the work item list.

## Changes

### 1. Config (`src/backends/local/config.ts`)

Add optional `defaultType?: string` to the `Config` interface. When set, the work item list starts filtered to this type instead of `types[0]`.

`current_iteration` already serves as the default iteration — no new field needed.

### 2. AppContext (`src/app.tsx`)

Add `defaultType: string | null` and `setDefaultType` to app state. Loaded from config at boot. Updated by Settings when the user changes the value.

### 3. Settings (`src/components/Settings.tsx`)

Remove the "Project Config" section (types, statuses, iterations, current_iteration display).

Add a "Defaults" section with two navigable rows:
- **Default type** — shows current `defaultType` value (or first type if unset)
- **Default iteration** — shows current `current_iteration` value

Pressing Enter on either row opens an inline picker overlay (matching the existing overlay pattern: state boolean, useInput guard, conditional JSX). The picker is populated from `config.types` or `config.iterations`. Selecting a value writes to config and updates app state.

New `NavItem` kinds: `{ kind: 'default-type' }` and `{ kind: 'default-iteration' }`.

### 4. WorkItemList (`src/components/WorkItemList.tsx`)

Change the `activeType` initialization fallback:

```ts
// Before
if (activeType === null && types.length > 0) {
  setActiveType(types[0]!);
}

// After
if (activeType === null && types.length > 0) {
  setActiveType(defaultType && types.includes(defaultType) ? defaultType : types[0]!);
}
```

### 5. Removed

The entire "Project Config" box showing types, statuses, iterations, and current_iteration as dimmed read-only text.
