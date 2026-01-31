# Backend Abstraction & Switching Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a backend factory with auto-detection, config-based backend switching, TUI settings screen, CLI config commands, and MCP set_backend tool.

**Architecture:** A `createBackend()` factory reads the `backend` field from `.tic/config.yml` and instantiates the correct backend. A `detectBackend()` function inspects git remotes to suggest a default during `tic init`. All hardcoded `new LocalBackend()` calls are replaced with the factory. A new TUI settings screen, CLI `config` commands, and MCP `set_backend` tool allow changing the backend.

**Tech Stack:** TypeScript, Vitest, Ink/React, Commander, MCP SDK, child_process (for git remote detection)

---

### Task 1: Add `backend` field to Config

**Files:**
- Modify: `src/backends/local/config.ts:5-19`
- Modify: `src/backends/local/config.test.ts`

**Step 1: Write the failing test**

Add to `src/backends/local/config.test.ts`:

```typescript
it('returns default config with backend field', () => {
  const config = readConfig(tmpDir);
  expect(config.backend).toBe('local');
});

it('reads config with custom backend', () => {
  const ticDir = path.join(tmpDir, '.tic');
  fs.mkdirSync(ticDir, { recursive: true });
  fs.writeFileSync(
    path.join(ticDir, 'config.yml'),
    'backend: github\ntypes:\n  - task\nstatuses:\n  - open\ncurrent_iteration: v1\niterations:\n  - v1\nnext_id: 1\n',
  );
  const config = readConfig(tmpDir);
  expect(config.backend).toBe('github');
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/backends/local/config.test.ts`
Expected: FAIL — `config.backend` is `undefined`

**Step 3: Write minimal implementation**

In `src/backends/local/config.ts`, add `backend` to the `Config` interface and `defaultConfig`:

```typescript
export interface Config {
  backend: string;
  types: string[];
  statuses: string[];
  current_iteration: string;
  iterations: string[];
  next_id: number;
}

export const defaultConfig: Config = {
  backend: 'local',
  types: ['epic', 'issue', 'task'],
  statuses: ['backlog', 'todo', 'in-progress', 'review', 'done'],
  current_iteration: 'default',
  iterations: ['default'],
  next_id: 1,
};
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/backends/local/config.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/backends/local/config.ts src/backends/local/config.test.ts
git commit -m "feat: add backend field to Config interface"
```

---

### Task 2: Create backend factory with `detectBackend` and `createBackend`

**Files:**
- Create: `src/backends/factory.ts`
- Create: `src/backends/factory.test.ts`

**Step 1: Write the failing tests**

Create `src/backends/factory.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createBackend, detectBackend, VALID_BACKENDS } from './factory.js';
import { writeConfig, defaultConfig } from './local/config.js';

describe('VALID_BACKENDS', () => {
  it('contains the four known backends', () => {
    expect(VALID_BACKENDS).toEqual(['local', 'github', 'gitlab', 'azure']);
  });
});

describe('detectBackend', () => {
  it('returns local when git remote fails', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-detect-'));
    const result = detectBackend(tmpDir);
    expect(result).toBe('local');
    fs.rmSync(tmpDir, { recursive: true });
  });
});

describe('createBackend', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-factory-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('creates a LocalBackend when backend is local', () => {
    writeConfig(tmpDir, { ...defaultConfig, backend: 'local' });
    const backend = createBackend(tmpDir);
    expect(backend.getStatuses()).toEqual(defaultConfig.statuses);
  });

  it('throws for unimplemented backends', () => {
    writeConfig(tmpDir, { ...defaultConfig, backend: 'github' });
    expect(() => createBackend(tmpDir)).toThrow('not yet implemented');
  });

  it('throws for unknown backend values', () => {
    writeConfig(tmpDir, { ...defaultConfig, backend: 'jira' });
    expect(() => createBackend(tmpDir)).toThrow('Unknown backend');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/backends/factory.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

Create `src/backends/factory.ts`:

```typescript
import { execSync } from 'node:child_process';
import type { Backend } from './types.js';
import { LocalBackend } from './local/index.js';
import { readConfig } from './local/config.js';

export const VALID_BACKENDS = ['local', 'github', 'gitlab', 'azure'] as const;
export type BackendType = (typeof VALID_BACKENDS)[number];

export function detectBackend(root: string): BackendType {
  try {
    const output = execSync('git remote -v', {
      cwd: root,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (output.includes('github.com')) return 'github';
    if (output.includes('gitlab.com')) return 'gitlab';
    if (output.includes('dev.azure.com')) return 'azure';
  } catch {
    // Not a git repo or git not available
  }
  return 'local';
}

export function createBackend(root: string): Backend {
  const config = readConfig(root);
  const backend = config.backend ?? 'local';

  switch (backend) {
    case 'local':
      return new LocalBackend(root);
    case 'github':
    case 'gitlab':
    case 'azure':
      throw new Error(
        `Backend "${backend}" is not yet implemented. Use "local" for now.`,
      );
    default:
      throw new Error(
        `Unknown backend "${backend}". Valid backends: ${VALID_BACKENDS.join(', ')}`,
      );
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/backends/factory.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/backends/factory.ts src/backends/factory.test.ts
git commit -m "feat: add backend factory with detectBackend and createBackend"
```

---

### Task 3: Wire factory into CLI, TUI, and MCP entry points

**Files:**
- Modify: `src/cli/index.ts:1-2,75-78`
- Modify: `src/index.tsx:4,10`
- Modify: `src/cli/commands/mcp.ts:4,574-576,579-592`

**Step 1: Update `src/cli/index.ts`**

Replace import and `createBackend` function:

```typescript
// Replace:
import { LocalBackend } from '../backends/local/index.js';

// With:
import { createBackend as createBackendFromConfig } from '../backends/factory.js';
```

Replace the `createBackend()` function (lines 75-78):

```typescript
function createBackend(): Backend {
  requireTicProject(process.cwd());
  return createBackendFromConfig(process.cwd());
}
```

Add the `Backend` type import:

```typescript
import type { Backend } from '../backends/types.js';
```

**Step 2: Update `src/index.tsx`**

Replace:
```typescript
import { LocalBackend } from './backends/local/index.js';
```
With:
```typescript
import { createBackend } from './backends/factory.js';
```

Replace:
```typescript
const backend = new LocalBackend(process.cwd());
```
With:
```typescript
const backend = createBackend(process.cwd());
```

**Step 3: Update `src/cli/commands/mcp.ts`**

Replace:
```typescript
import { LocalBackend } from '../../backends/local/index.js';
```
With:
```typescript
import { createBackend as createBackendFromConfig } from '../../backends/factory.js';
```

In `startMcpServer()`, replace the backend initialization (lines 574-593):

```typescript
let backend: Backend | null = isTicProject(root)
  ? createBackendFromConfig(root)
  : null;
const pendingDeletes = createDeleteTracker();

const guardedBackend = new Proxy({} as Backend, {
  get(_target, prop: string | symbol) {
    if (!backend) {
      if (isTicProject(root)) {
        backend = createBackendFromConfig(root);
      } else {
        throw new Error(
          'Not a tic project. Use the init_project tool first.',
        );
      }
    }
    return (backend as unknown as Record<string | symbol, unknown>)[prop];
  },
});
```

**Step 4: Run all tests to verify nothing is broken**

Run: `npm test`
Expected: All tests PASS

**Step 5: Run build to verify TypeScript compiles**

Run: `npm run build`
Expected: No errors

**Step 6: Commit**

```bash
git add src/cli/index.ts src/index.tsx src/cli/commands/mcp.ts
git commit -m "refactor: replace hardcoded LocalBackend with factory"
```

---

### Task 4: Update `tic init` to prompt for backend choice

**Files:**
- Modify: `src/cli/commands/init.ts`
- Modify: `src/cli/__tests__/init.test.ts`

**Step 1: Write the failing test**

Add to `src/cli/__tests__/init.test.ts`:

```typescript
import { readConfig } from '../../backends/local/config.js';

it('writes backend field to config on init', () => {
  runInit(tmpDir, 'local');
  const config = readConfig(tmpDir);
  expect(config.backend).toBe('local');
});

it('writes chosen backend to config', () => {
  runInit(tmpDir, 'github');
  const config = readConfig(tmpDir);
  expect(config.backend).toBe('github');
});

it('defaults to local when no backend specified', () => {
  runInit(tmpDir);
  const config = readConfig(tmpDir);
  expect(config.backend).toBe('local');
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/cli/__tests__/init.test.ts`
Expected: FAIL — `runInit` doesn't accept a second parameter

**Step 3: Update implementation**

In `src/cli/commands/init.ts`:

```typescript
import fs from 'node:fs';
import path from 'node:path';
import { writeConfig, defaultConfig } from '../../backends/local/config.js';

interface InitResult {
  success: boolean;
  alreadyExists: boolean;
}

export function runInit(root: string, backend?: string): InitResult {
  const configPath = path.join(root, '.tic', 'config.yml');
  if (fs.existsSync(configPath)) {
    return { success: true, alreadyExists: true };
  }
  writeConfig(root, { ...defaultConfig, backend: backend ?? 'local' });
  return { success: true, alreadyExists: false };
}
```

In `src/cli/index.ts`, update the `init` command action to prompt for backend. Add imports:

```typescript
import { detectBackend, VALID_BACKENDS } from '../backends/factory.js';
import { select } from '@inquirer/prompts';
```

Note: We need to add `@inquirer/prompts` as a dependency. If the project doesn't use inquirer, we can use a simpler approach with Commander's built-in prompt or a minimal select. Check if `@inquirer/prompts` is already available or use `ink-select-input` for TUI and a simple stdin approach for CLI.

**Alternative simpler approach:** Since the CLI is non-interactive by default and we want `tic init` to work both interactively and non-interactively, add a `--backend` flag to `tic init`:

Update the init command in `src/cli/index.ts`:

```typescript
program
  .command('init')
  .description('Initialize a new .tic project')
  .option('--backend <backend>', 'Backend type (local, github, gitlab, azure)')
  .action(async (opts: { backend?: string }) => {
    const parentOpts = program.opts<GlobalOpts>();
    try {
      let backend = opts.backend;
      if (!backend) {
        const detected = detectBackend(process.cwd());
        if (process.stdin.isTTY) {
          // Interactive: show detected and ask
          console.log(`Detected backend: ${detected}`);
          console.log(`Available backends: ${VALID_BACKENDS.join(', ')}`);
          console.log(`Using: ${detected} (pass --backend to override)`);
        }
        backend = detected;
      }
      if (!VALID_BACKENDS.includes(backend as any)) {
        throw new Error(
          `Invalid backend "${backend}". Valid: ${VALID_BACKENDS.join(', ')}`,
        );
      }
      const result = runInit(process.cwd(), backend);
      if (result.alreadyExists) {
        console.log('Already initialized in .tic/');
      } else {
        output(
          { initialized: true, backend },
          () => `Initialized .tic/ with backend: ${backend}`,
          parentOpts,
        );
      }
    } catch (err) {
      handleError(err, parentOpts.json);
    }
  });
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/cli/__tests__/init.test.ts`
Expected: PASS

**Step 5: Run full test suite**

Run: `npm test`
Expected: All PASS

**Step 6: Commit**

```bash
git add src/cli/commands/init.ts src/cli/__tests__/init.test.ts src/cli/index.ts
git commit -m "feat: add backend selection to tic init with auto-detection"
```

---

### Task 5: Add `tic config get` and `tic config set` CLI commands

**Files:**
- Modify: `src/cli/index.ts`
- Create: `src/cli/commands/config.ts`
- Create: `src/cli/__tests__/config.test.ts`

**Step 1: Write the failing tests**

Create `src/cli/__tests__/config.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runConfigGet, runConfigSet } from '../commands/config.js';
import { writeConfig, defaultConfig, readConfig } from '../../backends/local/config.js';
import { VALID_BACKENDS } from '../../backends/factory.js';

describe('tic config', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-config-test-'));
    writeConfig(tmpDir, { ...defaultConfig });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  describe('get', () => {
    it('returns the value of a config key', () => {
      const value = runConfigGet(tmpDir, 'backend');
      expect(value).toBe('local');
    });

    it('returns current_iteration', () => {
      const value = runConfigGet(tmpDir, 'current_iteration');
      expect(value).toBe('default');
    });

    it('throws for unknown keys', () => {
      expect(() => runConfigGet(tmpDir, 'nonexistent')).toThrow('Unknown config key');
    });
  });

  describe('set', () => {
    it('sets a backend value', () => {
      runConfigSet(tmpDir, 'backend', 'github');
      const config = readConfig(tmpDir);
      expect(config.backend).toBe('github');
    });

    it('validates backend values', () => {
      expect(() => runConfigSet(tmpDir, 'backend', 'jira')).toThrow('Invalid backend');
    });

    it('sets current_iteration', () => {
      runConfigSet(tmpDir, 'current_iteration', 'v2');
      const config = readConfig(tmpDir);
      expect(config.current_iteration).toBe('v2');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/cli/__tests__/config.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

Create `src/cli/commands/config.ts`:

```typescript
import { readConfig, writeConfig } from '../../backends/local/config.js';
import { VALID_BACKENDS } from '../../backends/factory.js';

const READABLE_KEYS = [
  'backend',
  'current_iteration',
  'types',
  'statuses',
  'iterations',
  'next_id',
] as const;

type ConfigKey = (typeof READABLE_KEYS)[number];

function isValidKey(key: string): key is ConfigKey {
  return (READABLE_KEYS as readonly string[]).includes(key);
}

export function runConfigGet(root: string, key: string): unknown {
  if (!isValidKey(key)) {
    throw new Error(
      `Unknown config key "${key}". Valid keys: ${READABLE_KEYS.join(', ')}`,
    );
  }
  const config = readConfig(root);
  return config[key];
}

export function runConfigSet(root: string, key: string, value: string): void {
  if (!isValidKey(key)) {
    throw new Error(
      `Unknown config key "${key}". Valid keys: ${READABLE_KEYS.join(', ')}`,
    );
  }
  const config = readConfig(root);

  if (key === 'backend') {
    if (!(VALID_BACKENDS as readonly string[]).includes(value)) {
      throw new Error(
        `Invalid backend "${value}". Valid backends: ${VALID_BACKENDS.join(', ')}`,
      );
    }
    config.backend = value;
  } else if (key === 'current_iteration') {
    config.current_iteration = value;
  } else {
    throw new Error(`Config key "${key}" is read-only`);
  }

  writeConfig(root, config);
}
```

**Step 4: Wire into CLI**

Add to `src/cli/index.ts`, after the iteration commands and before the mcp commands:

```typescript
import { runConfigGet, runConfigSet } from './commands/config.js';
```

```typescript
// tic config ...
const config = program.command('config').description('Manage project configuration');

config
  .command('get')
  .description('Get a configuration value')
  .argument('<key>', 'Config key')
  .action((key: string) => {
    const parentOpts = program.opts<GlobalOpts>();
    try {
      requireTicProject(process.cwd());
      const value = runConfigGet(process.cwd(), key);
      if (parentOpts.quiet) return;
      if (parentOpts.json) {
        console.log(formatJson({ [key]: value }));
      } else {
        console.log(Array.isArray(value) ? value.join('\n') : String(value));
      }
    } catch (err) {
      handleError(err, parentOpts.json);
    }
  });

config
  .command('set')
  .description('Set a configuration value')
  .argument('<key>', 'Config key')
  .argument('<value>', 'Config value')
  .action((key: string, value: string) => {
    const parentOpts = program.opts<GlobalOpts>();
    try {
      requireTicProject(process.cwd());
      runConfigSet(process.cwd(), key, value);
      if (!parentOpts.quiet) {
        if (parentOpts.json) {
          console.log(formatJson({ [key]: value }));
        } else {
          console.log(`Set ${key} = ${value}`);
        }
      }
    } catch (err) {
      handleError(err, parentOpts.json);
    }
  });
```

**Step 5: Run test to verify it passes**

Run: `npx vitest run src/cli/__tests__/config.test.ts`
Expected: PASS

**Step 6: Run full test suite and build**

Run: `npm test && npm run build`
Expected: All PASS, no build errors

**Step 7: Commit**

```bash
git add src/cli/commands/config.ts src/cli/__tests__/config.test.ts src/cli/index.ts
git commit -m "feat: add tic config get/set CLI commands"
```

---

### Task 6: Add TUI Settings screen

**Files:**
- Create: `src/components/Settings.tsx`
- Modify: `src/app.tsx:8,46-48`
- Modify: `src/components/WorkItemList.tsx:80,300-303`

**Step 1: Create the Settings component**

Create `src/components/Settings.tsx`:

```tsx
import { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { useAppState } from '../app.js';
import { readConfig, writeConfig } from '../backends/local/config.js';
import { VALID_BACKENDS } from '../backends/factory.js';

export function Settings() {
  const { navigate } = useAppState();
  const root = process.cwd();
  const config = useMemo(() => readConfig(root), [root]);

  const [cursor, setCursor] = useState(
    Math.max(
      0,
      VALID_BACKENDS.indexOf(config.backend as (typeof VALID_BACKENDS)[number]),
    ),
  );

  useInput((input, key) => {
    if (key.escape || input === ',') {
      navigate('list');
      return;
    }

    if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
    }
    if (key.downArrow) {
      setCursor((c) => Math.min(VALID_BACKENDS.length - 1, c + 1));
    }

    if (key.return) {
      const selected = VALID_BACKENDS[cursor]!;
      if (selected !== 'local') {
        // Non-local backends not yet available — do nothing
        return;
      }
      config.backend = selected;
      writeConfig(root, config);
    }
  });

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Settings
        </Text>
      </Box>

      <Text bold>Backend:</Text>
      {VALID_BACKENDS.map((b, idx) => {
        const selected = idx === cursor;
        const isCurrent = b === config.backend;
        const available = b === 'local';
        return (
          <Box key={b}>
            <Text color={selected ? 'cyan' : undefined}>
              {selected ? '>' : ' '}{' '}
            </Text>
            <Text
              color={selected ? 'cyan' : undefined}
              bold={selected}
              dimColor={!available}
            >
              {b}
              {isCurrent ? ' (current)' : ''}
              {!available ? ' (not yet available)' : ''}
            </Text>
          </Box>
        );
      })}

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

      <Box marginTop={1}>
        <Text dimColor>
          up/down: navigate enter: select esc/,: back
        </Text>
      </Box>
    </Box>
  );
}
```

**Step 2: Add `settings` screen to app routing**

In `src/app.tsx`:

Change the Screen type:
```typescript
type Screen = 'list' | 'form' | 'iteration-picker' | 'settings';
```

Add import:
```typescript
import { Settings } from './components/Settings.js';
```

Add render case in the JSX:
```tsx
{screen === 'settings' && <Settings />}
```

**Step 3: Add `,` key binding to WorkItemList**

In `src/components/WorkItemList.tsx`, in the `useInput` handler (after `if (input === 'i') navigate('iteration-picker');`):

```typescript
if (input === ',') navigate('settings');
```

Update the help text at the bottom to include `,: settings`:

```tsx
up/down: navigate enter: open c: create d: delete s: cycle status p:
set parent tab: type i: iteration ,: settings q: quit
```

**Step 4: Run build to verify TypeScript compiles**

Run: `npm run build`
Expected: No errors

**Step 5: Run full test suite**

Run: `npm test`
Expected: All PASS

**Step 6: Commit**

```bash
git add src/components/Settings.tsx src/app.tsx src/components/WorkItemList.tsx
git commit -m "feat: add TUI settings screen with backend selector"
```

---

### Task 7: Add `set_backend` MCP tool

**Files:**
- Modify: `src/cli/commands/mcp.ts`

**Step 1: Add handler function**

Add to `src/cli/commands/mcp.ts`, after the existing handler functions:

```typescript
import { readConfig, writeConfig } from '../../backends/local/config.js';
import { VALID_BACKENDS } from '../../backends/factory.js';

export function handleSetBackend(
  root: string,
  args: { backend: string },
): ToolResult {
  try {
    if (!(VALID_BACKENDS as readonly string[]).includes(args.backend)) {
      return error(
        `Invalid backend "${args.backend}". Valid backends: ${VALID_BACKENDS.join(', ')}`,
      );
    }
    const config = readConfig(root);
    config.backend = args.backend;
    writeConfig(root, config);
    return success({ backend: args.backend });
  } catch (err) {
    return error(err instanceof Error ? err.message : String(err));
  }
}
```

**Step 2: Register the tool**

In `registerTools()`, add after the `get_item_tree` registration:

```typescript
server.tool(
  'set_backend',
  'Set the backend type for this project',
  {
    backend: z
      .string()
      .describe(`Backend type: ${VALID_BACKENDS.join(', ')}`),
  },
  (args) => {
    return handleSetBackend(root, args);
  },
);
```

**Step 3: Update `handleGetConfig` to include backend**

The `handleGetConfig` function already returns statuses, types, iterations, and currentIteration. It gets these from the Backend interface. Since `backend` is a config-level field (not a Backend interface method), read it directly:

Update `handleGetConfig` signature and body:

```typescript
export function handleGetConfig(backend: Backend, root: string): ToolResult {
  try {
    const config = readConfig(root);
    return success({
      backend: config.backend,
      statuses: backend.getStatuses(),
      types: backend.getWorkItemTypes(),
      iterations: backend.getIterations(),
      currentIteration: backend.getCurrentIteration(),
    });
  } catch (err) {
    return error(err instanceof Error ? err.message : String(err));
  }
}
```

Update the `get_config` tool registration to pass `root`:

```typescript
server.tool('get_config', 'Get project configuration', () => {
  return handleGetConfig(backend, root);
});
```

**Step 4: Run build**

Run: `npm run build`
Expected: No errors

**Step 5: Run full test suite**

Run: `npm test`
Expected: All PASS

**Step 6: Commit**

```bash
git add src/cli/commands/mcp.ts
git commit -m "feat: add set_backend MCP tool and include backend in get_config"
```

---

### Task 8: Final verification

**Step 1: Run full test suite**

Run: `npm test`
Expected: All PASS

**Step 2: Run build**

Run: `npm run build`
Expected: No errors

**Step 3: Run lint and format check**

Run: `npm run lint && npm run format:check`
Expected: No errors

**Step 4: Fix any issues found**

If lint or format errors, fix with `npm run lint:fix && npm run format`.

**Step 5: Final commit if needed**

```bash
git add -A
git commit -m "chore: fix lint and formatting"
```
