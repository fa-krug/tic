# Auto-Update & Version Check Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add automatic version checking on launch and a self-update mechanism in the Settings screen.

**Architecture:** A new `update-checker.ts` module fetches the latest version from the npm registry. AppContext stores the result and WorkItemList shows a footer banner. Settings gets an "Updates" section with version display, manual check, update action, and auto-check toggle. The update itself exits tic, runs `npm install -g` via a separate `updater.ts` script, then relaunches.

**Tech Stack:** Node built-in `fetch`, `semver` (new dependency), `child_process.spawn`

---

### Task 1: Add semver dependency

**Files:**
- Modify: `package.json`

**Step 1: Install semver**

Run: `npm install semver && npm install -D @types/semver`

**Step 2: Verify install**

Run: `npm ls semver`
Expected: `semver@7.x.x` in dependency tree

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add semver dependency for version comparison"
```

---

### Task 2: Create update-checker module

**Files:**
- Create: `src/update-checker.ts`
- Create: `src/update-checker.test.ts`

**Step 1: Write the failing test**

Create `src/update-checker.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkForUpdate } from './update-checker.js';
import { VERSION } from './version.js';

describe('checkForUpdate', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns updateAvailable true when registry has newer version', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ version: '99.0.0' }),
    } as Response);

    const result = await checkForUpdate();
    expect(result).toEqual({
      current: VERSION,
      latest: '99.0.0',
      updateAvailable: true,
    });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://registry.npmjs.org/@sascha384/tic/latest',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('returns updateAvailable false when versions match', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ version: VERSION }),
    } as Response);

    const result = await checkForUpdate();
    expect(result).toEqual({
      current: VERSION,
      latest: VERSION,
      updateAvailable: false,
    });
  });

  it('returns null on network error', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockRejectedValue(new Error('network error'));

    const result = await checkForUpdate();
    expect(result).toBeNull();
  });

  it('returns null on non-ok response', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
    } as Response);

    const result = await checkForUpdate();
    expect(result).toBeNull();
  });

  it('returns null on invalid JSON', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ unexpected: 'shape' }),
    } as Response);

    const result = await checkForUpdate();
    expect(result).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/update-checker.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

Create `src/update-checker.ts`:

```typescript
import semver from 'semver';
import { VERSION } from './version.js';

export interface UpdateInfo {
  current: string;
  latest: string;
  updateAvailable: boolean;
}

const REGISTRY_URL = 'https://registry.npmjs.org/@sascha384/tic/latest';
const TIMEOUT_MS = 5000;

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(REGISTRY_URL, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) return null;

    const data = (await response.json()) as Record<string, unknown>;
    const latest = data.version;
    if (typeof latest !== 'string') return null;

    return {
      current: VERSION,
      latest,
      updateAvailable: semver.gt(latest, VERSION),
    };
  } catch {
    return null;
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/update-checker.test.ts`
Expected: All 5 tests PASS

**Step 5: Commit**

```bash
git add src/update-checker.ts src/update-checker.test.ts
git commit -m "feat: add update-checker module for npm registry version checks"
```

---

### Task 3: Add autoUpdate to config

**Files:**
- Modify: `src/backends/local/config.ts` (lines 6-19, 21-29)
- Modify: `src/backends/local/config.test.ts`

**Step 1: Write the failing test**

Add to `src/backends/local/config.test.ts`:

```typescript
it('returns default config with autoUpdate true', async () => {
  const config = await readConfig(tmpDir);
  expect(config.autoUpdate).toBe(true);
});

it('reads config with autoUpdate set to false', async () => {
  const ticDir = path.join(tmpDir, '.tic');
  fs.mkdirSync(ticDir, { recursive: true });
  fs.writeFileSync(
    path.join(ticDir, 'config.yml'),
    'autoUpdate: false\nstatuses:\n  - open\ncurrent_iteration: v1\niterations:\n  - v1\nnext_id: 1\n',
  );
  const config = await readConfig(tmpDir);
  expect(config.autoUpdate).toBe(false);
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/backends/local/config.test.ts`
Expected: FAIL — `config.autoUpdate` is `undefined`

**Step 3: Add autoUpdate to Config interface and default**

In `src/backends/local/config.ts`:

Add `autoUpdate: boolean;` to the `Config` interface (after `branchMode` line 13).

Add `autoUpdate: true,` to `defaultConfig` (after `branchMode: 'worktree'` line 28).

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/backends/local/config.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/backends/local/config.ts src/backends/local/config.test.ts
git commit -m "feat: add autoUpdate field to config"
```

---

### Task 4: Add updateInfo to AppContext and launch check

**Files:**
- Modify: `src/app.tsx` (lines 1-42, 50-136)

**Step 1: Update AppState interface and App component**

In `src/app.tsx`:

Add import at top:
```typescript
import { checkForUpdate } from './update-checker.js';
import type { UpdateInfo } from './update-checker.js';
import { readConfigSync } from './backends/local/config.js';
```

Add to `AppState` interface (after line 41, before the closing `}`):
```typescript
updateInfo: UpdateInfo | null;
```

Inside `App` function body (after `previousScreen` state, around line 68), add:
```typescript
const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);

useEffect(() => {
  const config = readConfigSync(process.cwd());
  if (config.autoUpdate !== false) {
    void checkForUpdate().then((info) => {
      if (info) setUpdateInfo(info);
    });
  }
}, []);
```

Add `updateInfo` to the `state` object (after `navigateBackFromHelp`, around line 120):
```typescript
updateInfo,
```

**Step 2: Verify build compiles**

Run: `npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add src/app.tsx
git commit -m "feat: add async update check on launch via AppContext"
```

---

### Task 5: Add footer banner to WorkItemList

**Files:**
- Modify: `src/components/WorkItemList.tsx` (lines 42-53, 700-977)

**Step 1: Add updateInfo to destructured AppState**

In `src/components/WorkItemList.tsx`, in the `useAppState()` destructuring (line 43-53), add `updateInfo` to the destructured properties.

**Step 2: Add banner JSX**

After the `warning` box (line 970-974) and before the final closing `</>` (line 975), add:

```tsx
{updateInfo?.updateAvailable && !confirmDelete && !settingParent && !settingAssignee && !settingLabels && (
  <Box>
    <Text color="yellow">
      Update available: {updateInfo.current} → {updateInfo.latest}  Press , to update in Settings
    </Text>
  </Box>
)}
```

**Step 3: Verify build compiles**

Run: `npm run build`
Expected: No errors

**Step 4: Commit**

```bash
git add src/components/WorkItemList.tsx
git commit -m "feat: add update-available footer banner to work item list"
```

---

### Task 6: Create updater script

**Files:**
- Create: `src/updater.ts`
- Create: `src/updater.test.ts`

**Step 1: Write the failing test**

Create `src/updater.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildUpdateCommand, buildRelaunchArgs } from './updater.js';

describe('updater', () => {
  describe('buildUpdateCommand', () => {
    it('returns npm install command for the package', () => {
      const cmd = buildUpdateCommand();
      expect(cmd).toBe('npm install -g @sascha384/tic@latest');
    });
  });

  describe('buildRelaunchArgs', () => {
    it('returns tic binary with original args', () => {
      const args = buildRelaunchArgs(['--json', 'item', 'list']);
      expect(args).toEqual({ command: 'tic', args: ['--json', 'item', 'list'] });
    });

    it('returns tic binary with empty args', () => {
      const args = buildRelaunchArgs([]);
      expect(args).toEqual({ command: 'tic', args: [] });
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/updater.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

Create `src/updater.ts`:

```typescript
import { execSync, spawn } from 'node:child_process';

const PACKAGE_NAME = '@sascha384/tic';

export function buildUpdateCommand(): string {
  return `npm install -g ${PACKAGE_NAME}@latest`;
}

export function buildRelaunchArgs(originalArgs: string[]): {
  command: string;
  args: string[];
} {
  return { command: 'tic', args: originalArgs };
}

export function runUpdate(originalArgs: string[]): void {
  const cmd = buildUpdateCommand();

  console.log(`\nUpdating ${PACKAGE_NAME}...\n`);

  try {
    execSync(cmd, { stdio: 'inherit' });
  } catch {
    console.error(`\nUpdate failed. Run manually: ${cmd}\n`);
    process.exit(1);
  }

  console.log('\nUpdate complete! Restarting tic...\n');

  const { command, args } = buildRelaunchArgs(originalArgs);
  const child = spawn(command, args, {
    stdio: 'inherit',
    detached: false,
  });

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });
}

// When run directly as a script
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('/updater.js') ||
    process.argv[1].endsWith('\\updater.js'));

if (isDirectRun) {
  const originalArgs = process.argv.slice(2);
  runUpdate(originalArgs);
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/updater.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/updater.ts src/updater.test.ts
git commit -m "feat: add updater script for exit-and-relaunch updates"
```

---

### Task 7: Add Updates section to Settings

**Files:**
- Modify: `src/components/Settings.tsx` (lines 1-16, 23-32, 40-41, 84-111, 131-237, 259-413)

This is the largest task. It adds the Updates section with version display, check action, update action, and auto-check toggle.

**Step 1: Add new NavItem kinds and imports**

In `src/components/Settings.tsx`:

Add imports at top:
```typescript
import { checkForUpdate } from '../update-checker.js';
import type { UpdateInfo } from '../update-checker.js';
import { VERSION } from '../version.js';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
```

Extend the `NavItem` type union (line 11-15) with:
```typescript
| { kind: 'updates-header' }
| { kind: 'update-version' }
| { kind: 'update-latest' }
| { kind: 'update-now' }
| { kind: 'update-check' }
| { kind: 'update-toggle' }
```

**Step 2: Add update state and build nav items**

Inside `Settings()`, after the template state declarations (around line 49), add:
```typescript
const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
const [updateChecking, setUpdateChecking] = useState(false);
```

Add a useEffect to check on mount (after the template useEffect, around line 61):
```typescript
useEffect(() => {
  setUpdateChecking(true);
  void checkForUpdate().then((info) => {
    setUpdateInfo(info);
    setUpdateChecking(false);
  });
}, []);
```

In the `navItems` useMemo (line 85-111), after the templates block and before `return items;`, add:
```typescript
items.push({ kind: 'updates-header' });
items.push({ kind: 'update-version' });
items.push({ kind: 'update-latest' });
if (updateInfo?.updateAvailable) {
  items.push({ kind: 'update-now' });
}
items.push({ kind: 'update-check' });
items.push({ kind: 'update-toggle' });
```

Add `updateInfo` to the useMemo dependency array.

**Step 3: Handle Enter on update nav items**

In the `useInput` handler's `key.return` block (line 197-220), add cases after the template case:
```typescript
else if (item.kind === 'update-check') {
  setUpdateChecking(true);
  void checkForUpdate().then((info) => {
    setUpdateInfo(info);
    setUpdateChecking(false);
  });
} else if (item.kind === 'update-now') {
  // Exit tic, spawn updater, let it relaunch
  const __filename = fileURLToPath(import.meta.url);
  const updaterPath = path.join(path.dirname(__filename), '..', 'updater.js');
  const originalArgs = process.argv.slice(2);
  spawn('node', [updaterPath, ...originalArgs], {
    stdio: 'inherit',
    detached: true,
  });
  process.exit(0);
} else if (item.kind === 'update-toggle') {
  if (config) {
    config.autoUpdate = !(config.autoUpdate !== false);
    void writeConfig(root, config);
    setConfig({ ...config });
  }
}
```

Update the cursor skip logic (lines 174-194) to also skip `updates-header` and `update-version` and `update-latest`:
```typescript
const isNonSelectable = (kind: string) =>
  kind === 'template-header' || kind === 'updates-header' || kind === 'update-version' || kind === 'update-latest';
```

Use `isNonSelectable(navItems[next]?.kind)` in both up/down arrow handlers instead of checking only `'template-header'`.

**Step 4: Render the Updates section**

After the templates section JSX (around line 391) and before the `confirmDeleteTemplate` block (line 393), add the Updates section:

```tsx
<Box marginTop={1} flexDirection="column">
  <Text bold>Updates:</Text>
  {navItems.map((item, idx) => {
    if (item.kind === 'updates-header' || item.kind === 'update-version' || item.kind === 'update-latest' || item.kind === 'update-now' || item.kind === 'update-check' || item.kind === 'update-toggle') {
      // handled here
    } else {
      return null;
    }

    const focused = idx === cursor;

    if (item.kind === 'updates-header') return null; // just the "Updates:" header above

    if (item.kind === 'update-version') {
      return (
        <Box key="update-version" marginLeft={2}>
          <Text dimColor>Current: v{VERSION}</Text>
        </Box>
      );
    }

    if (item.kind === 'update-latest') {
      return (
        <Box key="update-latest" marginLeft={2}>
          <Text dimColor>
            Latest:{' '}
            {updateChecking
              ? 'checking...'
              : updateInfo
                ? updateInfo.updateAvailable
                  ? `v${updateInfo.latest}`
                  : `v${updateInfo.latest} (up to date)`
                : 'unknown'}
          </Text>
        </Box>
      );
    }

    if (item.kind === 'update-now') {
      return (
        <Box key="update-now" marginLeft={2}>
          <Text color={focused ? 'cyan' : undefined}>
            {focused ? '>' : ' '}{' '}
          </Text>
          <Text bold={focused} color={focused ? 'cyan' : 'green'}>
            Update to v{updateInfo?.latest}
          </Text>
        </Box>
      );
    }

    if (item.kind === 'update-check') {
      return (
        <Box key="update-check" marginLeft={2}>
          <Text color={focused ? 'cyan' : undefined}>
            {focused ? '>' : ' '}{' '}
          </Text>
          <Text bold={focused} color={focused ? 'cyan' : undefined}>
            {updateChecking ? 'Checking...' : 'Check for updates'}
          </Text>
        </Box>
      );
    }

    if (item.kind === 'update-toggle') {
      return (
        <Box key="update-toggle" marginLeft={2}>
          <Text color={focused ? 'cyan' : undefined}>
            {focused ? '>' : ' '}{' '}
          </Text>
          <Text bold={focused} color={focused ? 'cyan' : undefined}>
            Auto-check on launch: {config?.autoUpdate !== false ? 'on' : 'off'}
          </Text>
        </Box>
      );
    }

    return null;
  })}
</Box>
```

**Step 5: Verify build compiles**

Run: `npm run build`
Expected: No errors

**Step 6: Run all tests**

Run: `npm test`
Expected: All tests pass

**Step 7: Run format and lint**

Run: `npm run format && npm run lint`
Expected: No errors

**Step 8: Commit**

```bash
git add src/components/Settings.tsx
git commit -m "feat: add Updates section to Settings with version check and auto-update"
```

---

### Task 8: Final verification and cleanup

**Step 1: Run full build + test + lint + format check**

Run: `npm run build && npm test && npm run lint && npm run format:check`
Expected: All pass

**Step 2: Manual smoke test**

Run: `npm start`
Expected:
- App launches immediately (no delay)
- After 1-2s, if a newer version exists, a yellow footer banner appears below the work item list
- Press `,` to go to Settings — see the new "Updates" section at the bottom
- "Current" and "Latest" version rows display correctly
- "Check for updates" triggers a fresh check
- "Auto-check on launch" toggles between on/off and persists to config
- If an update is available, "Update to vX.Y.Z" row appears

**Step 3: Commit any cleanup**

If any formatting or minor fixes were needed, commit them.
