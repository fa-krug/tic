# Config Store Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace all scattered config reads with a single Zustand store that serves both React and non-React code, with file watching for external changes.

**Architecture:** A vanilla Zustand store (`createStore`) at module scope provides `getState()` for non-React code and a `useConfigStore(selector)` hook for React. The store reads config once at init, watches the file for external changes, and writes through to disk on `update()`. LocalBackend drops its private config copy and reads from the store directly.

**Tech Stack:** Zustand 5, Node `fs.watch`, existing `readConfig`/`writeConfig` utilities

---

### Task 1: Install Zustand

**Files:**
- Modify: `package.json`

**Step 1: Install zustand**

Run: `npm install zustand`

**Step 2: Verify installation**

Run: `npm ls zustand`
Expected: `zustand@5.x.x` listed

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add zustand dependency"
```

---

### Task 2: Create the config store with tests

**Files:**
- Create: `src/stores/configStore.ts`
- Create: `src/stores/configStore.test.ts`

**Step 1: Write failing tests for init, get, update, and destroy**

Create `src/stores/configStore.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { configStore } from './configStore.js';
import { defaultConfig, writeConfig } from '../backends/local/config.js';

describe('configStore', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-config-store-'));
  });

  afterEach(() => {
    configStore.getState().destroy();
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('loads default config when no file exists', async () => {
    await configStore.getState().init(tmpDir);
    const { config, loaded } = configStore.getState();
    expect(loaded).toBe(true);
    expect(config.statuses).toEqual(defaultConfig.statuses);
    expect(config.next_id).toBe(1);
  });

  it('loads existing config from disk', async () => {
    const ticDir = path.join(tmpDir, '.tic');
    fs.mkdirSync(ticDir, { recursive: true });
    fs.writeFileSync(
      path.join(ticDir, 'config.yml'),
      'backend: github\nstatuses:\n  - open\ncurrent_iteration: v1\niterations:\n  - v1\nnext_id: 5\n',
    );
    await configStore.getState().init(tmpDir);
    const { config } = configStore.getState();
    expect(config.backend).toBe('github');
    expect(config.next_id).toBe(5);
  });

  it('updates config and writes to disk', async () => {
    await configStore.getState().init(tmpDir);
    await configStore.getState().update({ next_id: 42 });
    const { config } = configStore.getState();
    expect(config.next_id).toBe(42);
    // Verify disk
    const raw = fs.readFileSync(
      path.join(tmpDir, '.tic', 'config.yml'),
      'utf-8',
    );
    expect(raw).toContain('next_id: 42');
  });

  it('shallow merges partial updates', async () => {
    await configStore.getState().init(tmpDir);
    await configStore.getState().update({ backend: 'gitlab' });
    const { config } = configStore.getState();
    expect(config.backend).toBe('gitlab');
    expect(config.statuses).toEqual(defaultConfig.statuses); // unchanged
  });

  it('picks up external file changes', async () => {
    await configStore.getState().init(tmpDir);
    // Simulate external write (CLI, MCP, etc.)
    await writeConfig(tmpDir, {
      ...configStore.getState().config,
      next_id: 99,
    });
    // fs.watch is async — wait for debounce
    await new Promise((r) => setTimeout(r, 200));
    expect(configStore.getState().config.next_id).toBe(99);
  });

  it('does not double-trigger on self-writes', async () => {
    await configStore.getState().init(tmpDir);
    let changeCount = 0;
    const unsub = configStore.subscribe(() => {
      changeCount++;
    });
    await configStore.getState().update({ next_id: 10 });
    await new Promise((r) => setTimeout(r, 200));
    unsub();
    // Should have exactly 1 change (from update), not 2 (update + watcher)
    expect(changeCount).toBe(1);
  });

  it('destroy stops the file watcher', async () => {
    await configStore.getState().init(tmpDir);
    configStore.getState().destroy();
    // Write externally after destroy
    await writeConfig(tmpDir, {
      ...configStore.getState().config,
      next_id: 77,
    });
    await new Promise((r) => setTimeout(r, 200));
    // Store should NOT have updated
    expect(configStore.getState().config.next_id).not.toBe(77);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/stores/configStore.test.ts`
Expected: FAIL — module not found

**Step 3: Implement the config store**

Create `src/stores/configStore.ts`:

```typescript
import { createStore, useStore } from 'zustand';
import { watch, type FSWatcher } from 'node:fs';
import {
  readConfig,
  writeConfig,
  defaultConfig,
  type Config,
} from '../backends/local/config.js';

interface ConfigStoreState {
  config: Config;
  loaded: boolean;
  init(root: string): Promise<void>;
  update(partial: Partial<Config>): Promise<void>;
  destroy(): void;
}

let watcher: FSWatcher | null = null;
let writing = false;
let storeRoot = '';
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export const configStore = createStore<ConfigStoreState>((set, get) => ({
  config: { ...defaultConfig },
  loaded: false,

  async init(root: string) {
    storeRoot = root;
    const config = await readConfig(root);
    set({ config, loaded: true });

    // Watch for external changes
    try {
      const configPath = await import('node:path').then((p) =>
        p.join(root, '.tic', 'config.yml'),
      );
      // Ensure .tic dir exists before watching
      const fs = await import('node:fs/promises');
      await fs.mkdir(await import('node:path').then((p) => p.join(root, '.tic')), {
        recursive: true,
      });
      watcher = watch(configPath, () => {
        if (writing) return;
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          void readConfig(storeRoot).then((freshConfig) => {
            set({ config: freshConfig });
          });
        }, 50);
      });
      watcher.on('error', () => {
        // File may not exist yet — ignore
      });
    } catch {
      // Watcher setup failed — non-fatal
    }
  },

  async update(partial: Partial<Config>) {
    const merged = { ...get().config, ...partial };
    set({ config: merged });
    writing = true;
    try {
      await writeConfig(storeRoot, merged);
    } finally {
      // Brief delay to let fs.watch fire and be ignored
      setTimeout(() => {
        writing = false;
      }, 100);
    }
  },

  destroy() {
    if (watcher) {
      watcher.close();
      watcher = null;
    }
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  },
}));

export function useConfigStore<T>(selector: (s: ConfigStoreState) => T): T {
  return useStore(configStore, selector);
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/stores/configStore.test.ts`
Expected: All 7 tests PASS

**Step 5: Run full test suite to check no regressions**

Run: `npm test`
Expected: All tests PASS

**Step 6: Commit**

```bash
git add src/stores/configStore.ts src/stores/configStore.test.ts
git commit -m "feat: add Zustand config store with file watching"
```

---

### Task 3: Migrate LocalBackend to use the config store

**Files:**
- Modify: `src/backends/local/index.ts:33-55,90-141,222-243`
- Modify: `src/backends/local/index.test.ts:11-14`

**Step 1: Update LocalBackend to read from config store**

In `src/backends/local/index.ts`:

Remove `private config: Config` field (line 35) and the `config` constructor parameter (line 40).

Remove the `private save()` method (lines 90-92).

Remove the `readConfig` import usage in `create()` (line 53).

Replace the class to:

```typescript
import { configStore } from '../../stores/configStore.js';

export class LocalBackend extends BaseBackend {
  private root: string;
  private tempIds: boolean;

  private constructor(root: string, options?: LocalBackendOptions) {
    super(0);
    this.root = root;
    this.tempIds = options?.tempIds ?? false;
  }

  static async create(
    root: string,
    options?: LocalBackendOptions,
  ): Promise<LocalBackend> {
    // Ensure config store is initialized (idempotent if already init'd)
    if (!configStore.getState().loaded) {
      await configStore.getState().init(root);
    }
    return new LocalBackend(root, options);
  }
```

Replace config reads throughout:
- `this.config.statuses` → `configStore.getState().config.statuses`
- `this.config.iterations` → `configStore.getState().config.iterations`
- `this.config.types` → `configStore.getState().config.types`
- `this.config.current_iteration` → `configStore.getState().config.current_iteration`
- `this.config.next_id` → `configStore.getState().config.next_id`

Replace config writes:
- `setCurrentIteration`: `await configStore.getState().update({ current_iteration: name, iterations: [...] })`
- `syncConfigFromRemote`: `await configStore.getState().update({ iterations, current_iteration, statuses, types })`
- `createWorkItem`: `await configStore.getState().update({ next_id: id + 1, iterations: [...] })`

**Step 2: Update LocalBackend tests**

In `src/backends/local/index.test.ts`, add config store init to `beforeEach` and destroy to `afterEach`:

```typescript
import { configStore } from '../../stores/configStore.js';

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-test-'));
  await configStore.getState().init(tmpDir);
  backend = await LocalBackend.create(tmpDir);
});

afterEach(() => {
  configStore.getState().destroy();
  fs.rmSync(tmpDir, { recursive: true });
});
```

**Step 3: Run LocalBackend tests**

Run: `npx vitest run src/backends/local/index.test.ts`
Expected: All tests PASS

**Step 4: Run full test suite**

Run: `npm test`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/backends/local/index.ts src/backends/local/index.test.ts
git commit -m "refactor: migrate LocalBackend to use config store"
```

---

### Task 4: Migrate factory.ts to use the config store

**Files:**
- Modify: `src/backends/factory.ts:8,42-44,69-73`

**Step 1: Update factory to read from store**

In `src/backends/factory.ts`:

Replace `import { readConfig }` with `import { configStore }` from stores.

In `createBackend()`:
```typescript
export async function createBackend(root: string): Promise<Backend> {
  if (!configStore.getState().loaded) {
    await configStore.getState().init(root);
  }
  const backend = configStore.getState().config.backend ?? 'local';
  // ... rest stays the same with `backend` variable
```

In `createBackendWithSync()`:
```typescript
export async function createBackendWithSync(root: string): Promise<BackendSetup> {
  if (!configStore.getState().loaded) {
    await configStore.getState().init(root);
  }
  const backendType = configStore.getState().config.backend ?? 'local';
  // ... rest stays the same with `backendType` variable
```

**Step 2: Run build to check types**

Run: `npm run build`
Expected: No type errors

**Step 3: Run full test suite**

Run: `npm test`
Expected: All tests PASS

**Step 4: Commit**

```bash
git add src/backends/factory.ts
git commit -m "refactor: migrate factory to use config store"
```

---

### Task 5: Migrate Jira config to use the config store

**Files:**
- Modify: `src/backends/jira/config.ts:1,9-10`

**Step 1: Update readJiraConfig to read from store**

```typescript
import { configStore } from '../../stores/configStore.js';

export async function readJiraConfig(root: string): Promise<JiraConfig> {
  if (!configStore.getState().loaded) {
    const { readConfig } = await import('../local/config.js');
    const config = await readConfig(root);
    // Fall back to disk read for CLI context
    if (!config.jira) {
      throw new Error('Jira backend requires "jira" configuration in .tic/config.yml');
    }
    if (!config.jira.site) {
      throw new Error('Jira backend requires "jira.site" in .tic/config.yml');
    }
    if (!config.jira.project) {
      throw new Error('Jira backend requires "jira.project" in .tic/config.yml');
    }
    return config.jira;
  }
  const config = configStore.getState().config;
  if (!config.jira) {
    throw new Error('Jira backend requires "jira" configuration in .tic/config.yml');
  }
  if (!config.jira.site) {
    throw new Error('Jira backend requires "jira.site" in .tic/config.yml');
  }
  if (!config.jira.project) {
    throw new Error('Jira backend requires "jira.project" in .tic/config.yml');
  }
  return config.jira;
}
```

**Step 2: Run build**

Run: `npm run build`
Expected: No type errors

**Step 3: Commit**

```bash
git add src/backends/jira/config.ts
git commit -m "refactor: migrate Jira config to use config store"
```

---

### Task 6: Migrate app.tsx — drop config reads

**Files:**
- Modify: `src/app.tsx:1,15,46-47,76-88,121-144`

**Step 1: Update app.tsx**

Remove `readConfigSync` import (line 15).

Replace `defaultType` state with config store:
```typescript
import { useConfigStore } from './stores/configStore.js';
```

Remove `defaultType` from AppState interface, `useState`, and context value. Remove the `autoUpdate` useEffect.

In the App component body, read from config store:
```typescript
const defaultType = useConfigStore((s) => s.config.defaultType ?? null);
const autoUpdate = useConfigStore((s) => s.config.autoUpdate);
```

Use `autoUpdate` directly:
```typescript
useEffect(() => {
  if (autoUpdate !== false) {
    void checkForUpdate().then((info) => {
      if (info) setUpdateInfo(info);
    });
  }
}, [autoUpdate]);
```

Remove `defaultType` and `setDefaultType` from AppState interface and the context value object — components that need it will read from the config store directly.

**Step 2: Update Settings.tsx to use configStore.update for setDefaultType**

In `src/components/Settings.tsx`, remove `setDefaultType` from useAppState destructure. Replace:
```typescript
setDefaultType(type);
```
with:
```typescript
void configStore.getState().update({ defaultType: type });
```

Also update WorkItemList.tsx: replace `defaultType` from useAppState with:
```typescript
const defaultType = useConfigStore((s) => s.config.defaultType ?? null);
```

**Step 3: Run build**

Run: `npm run build`
Expected: No type errors

**Step 4: Run full test suite**

Run: `npm test`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/app.tsx src/components/Settings.tsx src/components/WorkItemList.tsx
git commit -m "refactor: migrate app.tsx and components to use config store for defaultType and autoUpdate"
```

---

### Task 7: Migrate Header.tsx — drop readConfigSync

**Files:**
- Modify: `src/components/Header.tsx:2,24-28`

**Step 1: Update Header to use config store hook**

Replace:
```typescript
import { readConfigSync } from '../backends/local/config.js';
```
with:
```typescript
import { useConfigStore } from '../stores/configStore.js';
```

Replace body:
```typescript
export function Header() {
  const backendType = useConfigStore((s) => s.config.backend ?? 'local');
  const backendLabel = BACKEND_LABELS[backendType] ?? backendType;
  const root = process.cwd();
  const projectPath = shortenPath(root);
```

**Step 2: Run build**

Run: `npm run build`
Expected: No type errors

**Step 3: Commit**

```bash
git add src/components/Header.tsx
git commit -m "refactor: migrate Header to use config store"
```

---

### Task 8: Migrate WorkItemList.tsx — drop readConfigSync for branchMode

**Files:**
- Modify: `src/components/WorkItemList.tsx:8,384,567`

**Step 1: Update WorkItemList**

Remove `readConfigSync` import (line 8).

Add at top of component:
```typescript
const branchMode = useConfigStore((s) => s.config.branchMode ?? 'worktree');
```

Replace both `readConfigSync` call sites (lines 384 and 567):
```typescript
// Before:
const config = readConfigSync(process.cwd());
// ... { branchMode: config.branchMode ?? 'worktree' }

// After (just use the branchMode variable directly):
// ... { branchMode }
```

**Step 2: Run build**

Run: `npm run build`
Expected: No type errors

**Step 3: Run full test suite**

Run: `npm test`
Expected: All tests PASS

**Step 4: Commit**

```bash
git add src/components/WorkItemList.tsx
git commit -m "refactor: migrate WorkItemList to use config store for branchMode"
```

---

### Task 9: Migrate Settings.tsx — use store instead of local config state

**Files:**
- Modify: `src/components/Settings.tsx:5-6,54,83-85,177-188,261-268,304-309,570-597`

**Step 1: Update Settings to use config store**

Remove:
```typescript
import { readConfig, writeConfig } from '../backends/local/config.js';
import type { Config } from '../backends/local/config.js';
```

Add:
```typescript
import { useConfigStore } from '../stores/configStore.js';
import { configStore } from '../stores/configStore.js';
```

Remove local config state:
```typescript
// Remove:
const [config, setConfig] = useState<Config | null>(null);
// Remove:
useEffect(() => {
  void readConfig(root).then(setConfig);
}, [root]);
```

Replace with config store hook:
```typescript
const config = useConfigStore((s) => s.config);
const configLoaded = useConfigStore((s) => s.loaded);
```

Update the loading guard:
```typescript
if (!configLoaded) {
  return (
    <Box>
      <Text dimColor>Loading...</Text>
    </Box>
  );
}
```

Replace all `void writeConfig(root, config)` calls with `void configStore.getState().update(...)`:

- Backend selection: `void configStore.getState().update({ backend: item.backend, ...(jira config) })`
- Jira config save: `void configStore.getState().update({ jira: { site, project, boardId } })`
- Auto-update toggle: `void configStore.getState().update({ autoUpdate: !(config.autoUpdate !== false) })`
- Default type: `void configStore.getState().update({ defaultType: type })`
- Default iteration: `void configStore.getState().update({ current_iteration: iteration })`

Remove all `setConfig({ ...config })` calls — the store handles reactivity.

**Step 2: Run build**

Run: `npm run build`
Expected: No type errors

**Step 3: Run full test suite**

Run: `npm test`
Expected: All tests PASS

**Step 4: Commit**

```bash
git add src/components/Settings.tsx
git commit -m "refactor: migrate Settings to use config store"
```

---

### Task 10: Wire up init/destroy in index.tsx

**Files:**
- Modify: `src/index.tsx:1-17`

**Step 1: Add init before render, destroy on exit**

```typescript
#!/usr/bin/env node
import { render } from 'ink';
import { App } from './app.js';
import { createBackendWithSync } from './backends/factory.js';
import { runCli } from './cli/index.js';
import { configStore } from './stores/configStore.js';

if (process.argv.length > 2) {
  await runCli(process.argv);
} else {
  await configStore.getState().init(process.cwd());
  const { backend, syncManager } = await createBackendWithSync(process.cwd());

  if (syncManager) {
    syncManager.sync().catch(() => {});
  }

  const app = render(<App backend={backend} syncManager={syncManager} />);
  await app.waitUntilExit();
  configStore.getState().destroy();
}
```

**Step 2: Run build**

Run: `npm run build`
Expected: No type errors

**Step 3: Run the TUI manually to verify**

Run: `npm start`
Expected: TUI starts, shows items, config-dependent features work (header shows backend, branchMode works, settings reflect current config)

**Step 4: Commit**

```bash
git add src/index.tsx
git commit -m "feat: wire up config store init/destroy in TUI entry point"
```

---

### Task 11: Clean up — remove unused readConfigSync

**Files:**
- Modify: `src/backends/local/config.ts:2,48-53`

**Step 1: Check if readConfigSync is still imported anywhere**

Run: `grep -r 'readConfigSync' src/ --include='*.ts' --include='*.tsx'`

If no results (other than its definition and CLI code), remove the function and the `fsSync` import from `config.ts`.

Note: The CLI (`src/cli/index.ts`) may still use `readConfigSync` — check and keep if needed.

**Step 2: Run build**

Run: `npm run build`
Expected: No type errors

**Step 3: Run full test suite + lint + format check**

Run: `npm test && npm run lint && npm run format:check`
Expected: All pass

**Step 4: Commit**

```bash
git add src/backends/local/config.ts
git commit -m "refactor: remove unused readConfigSync"
```

---

### Task 12: Final verification

**Step 1: Run full quality checks**

Run: `npm run build && npm test && npm run lint && npm run format:check`
Expected: All pass

**Step 2: Manual smoke test**

Run: `npm start`
Verify:
- Header shows correct backend label
- Settings screen loads config, edits persist
- Branch/worktree creation uses correct branchMode
- Default type filter works
- Auto-update check respects config

**Step 3: Squash or keep commits as-is based on preference**
