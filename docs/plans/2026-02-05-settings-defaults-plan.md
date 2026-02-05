# Settings Defaults Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the read-only "Project Config" section in Settings with editable default type and default iteration pickers.

**Architecture:** Add `defaultType` to config, thread it through `AppContext`, and use inline picker overlays in Settings to edit both values. WorkItemList reads `defaultType` from context for initial filter.

**Tech Stack:** TypeScript, React 19, Ink 6, ink-select-input, vitest

---

### Task 1: Add `defaultType` to Config

**Files:**
- Modify: `src/backends/local/config.ts:6-20`
- Test: `src/backends/local/config.test.ts`

**Step 1: Write failing tests**

Add these two tests at the end of the `describe('config', ...)` block (before the `readConfigSync` describe):

```typescript
it('returns default config with no defaultType', async () => {
  const config = await readConfig(tmpDir);
  expect(config.defaultType).toBeUndefined();
});

it('reads config with defaultType', async () => {
  const ticDir = path.join(tmpDir, '.tic');
  fs.mkdirSync(ticDir, { recursive: true });
  fs.writeFileSync(
    path.join(ticDir, 'config.yml'),
    'defaultType: task\nstatuses:\n  - open\ncurrent_iteration: v1\niterations:\n  - v1\nnext_id: 1\n',
  );
  const config = await readConfig(tmpDir);
  expect(config.defaultType).toBe('task');
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/backends/local/config.test.ts`
Expected: Tests pass trivially since YAML parse returns whatever keys exist. The first test should pass (undefined by default) and the second should also pass since yaml.parse just returns the field. If both pass, that confirms the config layer works — move on.

**Step 3: Add `defaultType` to Config interface**

In `src/backends/local/config.ts`, add `defaultType?: string;` to the `Config` interface after `autoUpdate: boolean;`:

```typescript
export interface Config {
  backend: string;
  types: string[];
  statuses: string[];
  current_iteration: string;
  iterations: string[];
  next_id: number;
  branchMode: 'worktree' | 'branch';
  autoUpdate: boolean;
  defaultType?: string;
  jira?: {
    site: string;
    project: string;
    boardId?: number;
  };
}
```

No change to `defaultConfig` needed — the field is optional and absent by default.

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/backends/local/config.test.ts`
Expected: All tests pass.

**Step 5: Commit**

```bash
git add src/backends/local/config.ts src/backends/local/config.test.ts
git commit -m "feat: add defaultType to config interface"
```

---

### Task 2: Thread `defaultType` through AppContext

**Files:**
- Modify: `src/app.tsx:25-46` (AppState interface), `src/app.tsx:61-82` (state init), `src/app.tsx:115-136` (state object)

**Step 1: Add `defaultType` and `setDefaultType` to AppState interface**

In `src/app.tsx`, add to the `AppState` interface:

```typescript
defaultType: string | null;
setDefaultType: (type: string | null) => void;
```

**Step 2: Add state and initialization in App component**

In the `App` function, after the `updateInfo` state, add:

```typescript
const [defaultType, setDefaultType] = useState<string | null>(() => {
  const config = readConfigSync(process.cwd());
  return config.defaultType ?? null;
});
```

**Step 3: Add to state object**

In the `state: AppState = { ... }` object, add:

```typescript
defaultType,
setDefaultType,
```

**Step 4: Run build to verify no type errors**

Run: `npm run build`
Expected: Compiles with no errors.

**Step 5: Commit**

```bash
git add src/app.tsx
git commit -m "feat: thread defaultType through AppContext"
```

---

### Task 3: Use `defaultType` in WorkItemList

**Files:**
- Modify: `src/components/WorkItemList.tsx:133-137`

**Step 1: Destructure `defaultType` from app state**

In `WorkItemList`, add `defaultType` to the destructured `useAppState()` call (line ~49):

```typescript
const {
  backend,
  syncManager,
  navigate,
  navigateToHelp,
  selectWorkItem,
  activeType,
  setActiveType,
  setActiveTemplate,
  setFormMode,
  updateInfo,
  defaultType,
} = useAppState();
```

**Step 2: Update the activeType initialization**

Change the `useEffect` at line ~133 from:

```typescript
useEffect(() => {
  if (activeType === null && types.length > 0) {
    setActiveType(types[0]!);
  }
}, [activeType, types, setActiveType]);
```

To:

```typescript
useEffect(() => {
  if (activeType === null && types.length > 0) {
    setActiveType(
      defaultType && types.includes(defaultType) ? defaultType : types[0]!,
    );
  }
}, [activeType, types, setActiveType, defaultType]);
```

**Step 3: Run build to verify no type errors**

Run: `npm run build`
Expected: Compiles with no errors.

**Step 4: Commit**

```bash
git add src/components/WorkItemList.tsx
git commit -m "feat: use defaultType from config for initial type filter"
```

---

### Task 4: Refactor Settings — remove Project Config, add Defaults section

**Files:**
- Modify: `src/components/Settings.tsx`

This is the largest task. We need to:
1. Add new NavItem kinds for `default-type` and `default-iteration`
2. Add picker overlay state
3. Remove the "Project Config" display section
4. Add the "Defaults" section with picker overlays

**Step 1: Add new NavItem kinds**

Update the `NavItem` type at the top of Settings.tsx:

```typescript
type NavItem =
  | { kind: 'backend'; backend: string }
  | { kind: 'jira-field'; field: 'site' | 'project' | 'boardId' }
  | { kind: 'default-type' }
  | { kind: 'default-iteration' }
  | { kind: 'template-header' }
  | { kind: 'template'; slug: string; name: string }
  | { kind: 'updates-header' }
  | { kind: 'update-now' }
  | { kind: 'update-check' }
  | { kind: 'update-toggle' };
```

**Step 2: Add picker overlay state**

Add these state variables after the existing state declarations:

```typescript
const [showDefaultTypePicker, setShowDefaultTypePicker] = useState(false);
const [showDefaultIterationPicker, setShowDefaultIterationPicker] =
  useState(false);
```

**Step 3: Destructure `setDefaultType` from app state**

Add `setDefaultType` to the `useAppState()` destructuring:

```typescript
const {
  navigate,
  navigateToHelp,
  backend,
  syncManager,
  setFormMode,
  setEditingTemplateSlug,
  selectWorkItem,
  setDefaultType,
} = useAppState();
```

**Step 4: Insert default items into navItems**

In the `navItems` useMemo, after the jira fields insertion block and before the templates block, add:

```typescript
items.push({ kind: 'default-type' });
items.push({ kind: 'default-iteration' });
```

Also update the useMemo dependency array — it should not need new deps since config is already tracked.

**Step 5: Add skip logic for default-type/default-iteration in cursor navigation**

In the up/down arrow handlers, the headers are already skipped. The new kinds are navigable, so no skip logic needed.

**Step 6: Handle Enter on default-type and default-iteration**

In the `useInput` handler's `key.return` block, add cases:

```typescript
} else if (item.kind === 'default-type') {
  setShowDefaultTypePicker(true);
} else if (item.kind === 'default-iteration') {
  setShowDefaultIterationPicker(true);
}
```

**Step 7: Add early return guards for picker overlays**

In the navigation mode `useInput` (the one with `{ isActive: !editing }`), change the isActive condition to also check picker state:

```typescript
{ isActive: !editing && !showDefaultTypePicker && !showDefaultIterationPicker },
```

**Step 8: Remove the "Project Config" JSX section**

Delete this entire block from the return JSX:

```tsx
<Box marginTop={1} flexDirection="column">
  <Text bold>Project Config:</Text>
  <Box marginLeft={2}>
    <Text dimColor>Types: {config.types.join(', ')}</Text>
  </Box>
  <Box marginLeft={2}>
    <Text dimColor>Statuses: {config.statuses.join(', ')}</Text>
  </Box>
  <Box marginLeft={2}>
    <Text dimColor>Iterations: {config.iterations.join(', ')}</Text>
  </Box>
  <Box marginLeft={2}>
    <Text dimColor>Current iteration: {config.current_iteration}</Text>
  </Box>
</Box>
```

**Step 9: Add "Defaults" section to the JSX**

After the backend nav items map (after the closing `})}` for that map) and before the templates section, add:

```tsx
<Box marginTop={1} flexDirection="column">
  <Text bold>Defaults:</Text>
  {navItems.map((item, idx) => {
    if (item.kind !== 'default-type' && item.kind !== 'default-iteration')
      return null;
    const focused = idx === cursor;
    const label =
      item.kind === 'default-type' ? 'Default type' : 'Default iteration';
    const value =
      item.kind === 'default-type'
        ? config.defaultType ?? config.types[0] ?? 'none'
        : config.current_iteration;
    return (
      <Box key={item.kind} marginLeft={2}>
        <Text color={focused ? 'cyan' : undefined}>
          {focused ? '>' : ' '}{' '}
        </Text>
        <Text bold={focused} color={focused ? 'cyan' : undefined}>
          {label}: {value}
        </Text>
      </Box>
    );
  })}
</Box>
```

**Step 10: Add picker overlays to the JSX**

At the bottom of the return, just before the hint bar, add:

```tsx
{showDefaultTypePicker && (
  <Box position="absolute" marginTop={2} marginLeft={4}>
    <TypePicker
      types={config.types}
      onSelect={(type) => {
        config.defaultType = type;
        void writeConfig(root, config);
        setConfig({ ...config });
        setDefaultType(type);
        setShowDefaultTypePicker(false);
      }}
      onCancel={() => setShowDefaultTypePicker(false)}
    />
  </Box>
)}

{showDefaultIterationPicker && (
  <Box position="absolute" marginTop={2} marginLeft={4}>
    <StatusPicker
      statuses={config.iterations}
      onSelect={(iteration) => {
        config.current_iteration = iteration;
        void writeConfig(root, config);
        setConfig({ ...config });
        setShowDefaultIterationPicker(false);
      }}
      onCancel={() => setShowDefaultIterationPicker(false)}
    />
  </Box>
)}
```

Note: We reuse `TypePicker` for types and `StatusPicker` for iterations (it's just a generic list picker with a different title — the title says "Set Status" but that's acceptable, or we could create a generic picker). Actually, `StatusPicker` says "Set Status" in the header which is misleading for iterations. Let's create a simple generic `DefaultPicker` component instead — see Task 5.

**Step 11: Add import for TypePicker**

Add to Settings.tsx imports:

```typescript
import { TypePicker } from './TypePicker.js';
```

**Step 12: Run build to verify no type errors**

Run: `npm run build`
Expected: Compiles with no errors.

**Step 13: Commit**

```bash
git add src/components/Settings.tsx
git commit -m "feat: replace Project Config with editable Defaults section in Settings"
```

---

### Task 5: Create a generic DefaultPicker for iteration

**Files:**
- Create: `src/components/DefaultPicker.tsx`
- Modify: `src/components/Settings.tsx` (replace StatusPicker usage)

**Step 1: Create DefaultPicker component**

```typescript
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';

interface DefaultPickerProps {
  title: string;
  options: string[];
  onSelect: (value: string) => void;
  onCancel: () => void;
}

export function DefaultPicker({
  title,
  options,
  onSelect,
  onCancel,
}: DefaultPickerProps) {
  useInput((_input, key) => {
    if (key.escape) {
      onCancel();
    }
  });

  const items = options.map((o) => ({
    label: o,
    value: o,
  }));

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
    >
      <Box marginBottom={1}>
        <Text bold color="cyan">
          {title}
        </Text>
      </Box>
      <SelectInput items={items} onSelect={(item) => onSelect(item.value)} />
      <Box marginTop={1}>
        <Text dimColor>{'↑↓ navigate  enter select  esc cancel'}</Text>
      </Box>
    </Box>
  );
}
```

**Step 2: Update Settings to use DefaultPicker**

Replace both picker overlays in Settings.tsx to use `DefaultPicker`:

For default type:
```tsx
{showDefaultTypePicker && (
  <Box position="absolute" marginTop={2} marginLeft={4}>
    <DefaultPicker
      title="Default Type"
      options={config.types}
      onSelect={(type) => {
        config.defaultType = type;
        void writeConfig(root, config);
        setConfig({ ...config });
        setDefaultType(type);
        setShowDefaultTypePicker(false);
      }}
      onCancel={() => setShowDefaultTypePicker(false)}
    />
  </Box>
)}
```

For default iteration:
```tsx
{showDefaultIterationPicker && (
  <Box position="absolute" marginTop={2} marginLeft={4}>
    <DefaultPicker
      title="Default Iteration"
      options={config.iterations}
      onSelect={(iteration) => {
        config.current_iteration = iteration;
        void writeConfig(root, config);
        setConfig({ ...config });
        setShowDefaultIterationPicker(false);
      }}
      onCancel={() => setShowDefaultIterationPicker(false)}
    />
  </Box>
)}
```

Remove the `TypePicker` import added in Task 4 and add:

```typescript
import { DefaultPicker } from './DefaultPicker.js';
```

**Step 3: Run build**

Run: `npm run build`
Expected: Compiles with no errors.

**Step 4: Commit**

```bash
git add src/components/DefaultPicker.tsx src/components/Settings.tsx
git commit -m "feat: add DefaultPicker component for settings overlays"
```

---

### Task 6: Final verification

**Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass.

**Step 2: Run lint and format check**

Run: `npm run lint && npm run format:check`
Expected: No errors.

**Step 3: Run format if needed**

Run: `npm run format`

**Step 4: Manual smoke test**

Run: `npm start`
- Navigate to Settings (`,` key from list)
- Verify "Project Config" section is gone
- Verify "Defaults" section shows with "Default type" and "Default iteration"
- Press Enter on "Default type" — picker should appear with types
- Select a type — should save and update display
- Press Enter on "Default iteration" — picker should appear with iterations
- Select an iteration — should save and update display
- Press Esc to go back to list
- Verify the list is filtered to the selected default type

**Step 5: Final commit if any formatting changes**

```bash
git add -A
git commit -m "chore: format"
```
