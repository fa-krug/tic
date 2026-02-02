# Jira Backend Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Jira Cloud backend to tic using the Atlassian CLI (acli) as the interface layer, following the same patterns as existing GitHub, GitLab, and Azure DevOps backends.

**Architecture:** The Jira backend extends `BaseBackend` and delegates all Jira operations to the `acli` CLI. Unlike other backends that auto-detect from git remotes, Jira requires explicit configuration in `.tic/config.yml` (site URL, project key, optional board ID for sprints). The backend supports relationships (parent via `--parent` flag, dependencies via issue links), priority mapping, assignees, labels, comments, and sprint-based iterations.

**Tech Stack:** TypeScript, `execFileSync` for CLI calls, vitest for testing, `acli` CLI for Jira Cloud API access.

---

## Task 1: ACLI Wrapper (`src/backends/jira/acli.ts`)

**Files:**
- Create: `src/backends/jira/acli.ts`
- Test: `src/backends/jira/acli.test.ts`

**Step 1: Write the failing test for `acli.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { acli, acliExec } from './acli.js';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

const mockExecFileSync = vi.mocked(execFileSync);

describe('acli', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses JSON output from acli command', () => {
    mockExecFileSync.mockReturnValue('{"key": "TEAM-1", "fields": {}}');
    const result = acli<{ key: string; fields: Record<string, unknown> }>(
      ['jira', 'workitem', 'view', 'TEAM-1', '--json'],
      '/tmp',
    );
    expect(result).toEqual({ key: 'TEAM-1', fields: {} });
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'acli',
      ['jira', 'workitem', 'view', 'TEAM-1', '--json'],
      { cwd: '/tmp', encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
  });

  it('throws on acli command failure', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('acli: command failed');
    });
    expect(() => acli(['jira', 'workitem', 'view', 'TEAM-999'], '/tmp')).toThrow();
  });
});

describe('acliExec', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns raw string output', () => {
    mockExecFileSync.mockReturnValue('OK\n');
    const result = acliExec(['jira', 'auth', 'status'], '/tmp');
    expect(result).toBe('OK\n');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/backends/jira/acli.test.ts`
Expected: FAIL — module `./acli.js` not found

**Step 3: Write minimal implementation**

```typescript
import { execFileSync } from 'node:child_process';

export function acli<T>(args: string[], cwd: string): T {
  const result = execFileSync('acli', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return JSON.parse(result) as T;
}

export function acliExec(args: string[], cwd: string): string {
  return execFileSync('acli', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/backends/jira/acli.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/backends/jira/acli.ts src/backends/jira/acli.test.ts
git commit -m "feat(jira): add acli CLI wrapper"
```

---

## Task 2: Jira Config Reader (`src/backends/jira/config.ts`)

**Files:**
- Create: `src/backends/jira/config.ts`
- Test: `src/backends/jira/config.test.ts`
- Modify: `src/backends/local/config.ts` (add `jira?` field to `Config` interface)

**Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readJiraConfig } from './config.js';
import { writeConfig, defaultConfig } from '../local/config.js';

describe('readJiraConfig', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-jira-config-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('reads jira config from .tic/config.yml', async () => {
    await writeConfig(tmpDir, {
      ...defaultConfig,
      backend: 'jira',
      jira: {
        site: 'https://mycompany.atlassian.net',
        project: 'TEAM',
        boardId: 6,
      },
    });
    const config = await readJiraConfig(tmpDir);
    expect(config.site).toBe('https://mycompany.atlassian.net');
    expect(config.project).toBe('TEAM');
    expect(config.boardId).toBe(6);
  });

  it('throws when jira config is missing', async () => {
    await writeConfig(tmpDir, { ...defaultConfig, backend: 'jira' });
    await expect(readJiraConfig(tmpDir)).rejects.toThrow(
      'Jira backend requires "jira" configuration',
    );
  });

  it('throws when site is missing', async () => {
    await writeConfig(tmpDir, {
      ...defaultConfig,
      backend: 'jira',
      jira: { project: 'TEAM' },
    } as any);
    await expect(readJiraConfig(tmpDir)).rejects.toThrow('jira.site');
  });

  it('throws when project is missing', async () => {
    await writeConfig(tmpDir, {
      ...defaultConfig,
      backend: 'jira',
      jira: { site: 'https://x.atlassian.net' },
    } as any);
    await expect(readJiraConfig(tmpDir)).rejects.toThrow('jira.project');
  });

  it('allows boardId to be optional', async () => {
    await writeConfig(tmpDir, {
      ...defaultConfig,
      backend: 'jira',
      jira: {
        site: 'https://mycompany.atlassian.net',
        project: 'TEAM',
      },
    });
    const config = await readJiraConfig(tmpDir);
    expect(config.boardId).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/backends/jira/config.test.ts`
Expected: FAIL — module not found

**Step 3: Modify Config interface in `src/backends/local/config.ts`**

Add the `jira?` field to the `Config` interface:

```typescript
export interface Config {
  backend: string;
  types: string[];
  statuses: string[];
  current_iteration: string;
  iterations: string[];
  next_id: number;
  branchMode: 'worktree' | 'branch';
  jira?: {
    site: string;
    project: string;
    boardId?: number;
  };
}
```

**Step 4: Write `src/backends/jira/config.ts`**

```typescript
import { readConfig } from '../local/config.js';

export interface JiraConfig {
  site: string;
  project: string;
  boardId?: number;
}

export async function readJiraConfig(root: string): Promise<JiraConfig> {
  const config = await readConfig(root);
  if (!config.jira) {
    throw new Error(
      'Jira backend requires "jira" configuration in .tic/config.yml',
    );
  }
  if (!config.jira.site) {
    throw new Error(
      'Jira backend requires "jira.site" in .tic/config.yml',
    );
  }
  if (!config.jira.project) {
    throw new Error(
      'Jira backend requires "jira.project" in .tic/config.yml',
    );
  }
  return config.jira;
}
```

**Step 5: Run test to verify it passes**

Run: `npx vitest run src/backends/jira/config.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/backends/jira/config.ts src/backends/jira/config.test.ts src/backends/local/config.ts
git commit -m "feat(jira): add Jira config reader and extend Config interface"
```

---

## Task 3: Mappers (`src/backends/jira/mappers.ts`)

**Files:**
- Create: `src/backends/jira/mappers.ts`
- Test: `src/backends/jira/mappers.test.ts`

Jira returns issues in a specific JSON structure. We need interfaces for Jira responses and mapper functions that convert to `WorkItem`. The exact JSON shape from `acli --json` output uses Jira's standard fields structure. Key mappings:

- **ID**: Jira issue key (e.g. `TEAM-123`) — used as-is (string)
- **Status**: Jira status name (e.g. `To Do`, `In Progress`, `Done`) — lowercased
- **Type**: Jira issue type name (e.g. `Story`, `Bug`, `Epic`) — lowercased
- **Priority**: Jira priority name → tic priority (`Highest`/`Critical` → `critical`, `High` → `high`, `Medium` → `medium`, `Low`/`Lowest` → `low`)
- **Parent**: From `fields.parent.key` if present
- **Dependencies**: Extracted from `fields.issuelinks` where `type.inward` is `"is blocked by"` — the linked issue key
- **Sprint**: From `fields.sprint.name` if present
- **Comments**: From separate comment list API response

**Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import {
  mapIssueToWorkItem,
  mapCommentToComment,
  mapPriorityToTic,
  mapPriorityToJira,
  extractDependsOn,
} from './mappers.js';

describe('mapPriorityToTic', () => {
  it('maps Highest to critical', () => {
    expect(mapPriorityToTic('Highest')).toBe('critical');
  });
  it('maps High to high', () => {
    expect(mapPriorityToTic('High')).toBe('high');
  });
  it('maps Medium to medium', () => {
    expect(mapPriorityToTic('Medium')).toBe('medium');
  });
  it('maps Low to low', () => {
    expect(mapPriorityToTic('Low')).toBe('low');
  });
  it('maps Lowest to low', () => {
    expect(mapPriorityToTic('Lowest')).toBe('low');
  });
  it('defaults to medium for unknown', () => {
    expect(mapPriorityToTic(undefined)).toBe('medium');
  });
});

describe('mapPriorityToJira', () => {
  it('maps critical to Highest', () => {
    expect(mapPriorityToJira('critical')).toBe('Highest');
  });
  it('maps high to High', () => {
    expect(mapPriorityToJira('high')).toBe('High');
  });
  it('maps medium to Medium', () => {
    expect(mapPriorityToJira('medium')).toBe('Medium');
  });
  it('maps low to Low', () => {
    expect(mapPriorityToJira('low')).toBe('Low');
  });
});

describe('extractDependsOn', () => {
  it('extracts keys from "is blocked by" inward links', () => {
    const links = [
      {
        type: { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
        inwardIssue: { key: 'TEAM-5' },
      },
      {
        type: { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
        outwardIssue: { key: 'TEAM-10' },
      },
    ];
    expect(extractDependsOn(links)).toEqual(['TEAM-5']);
  });

  it('returns empty array for no links', () => {
    expect(extractDependsOn(undefined)).toEqual([]);
    expect(extractDependsOn([])).toEqual([]);
  });
});

describe('mapIssueToWorkItem', () => {
  it('maps a full Jira issue to a WorkItem', () => {
    const jiraIssue = {
      key: 'TEAM-42',
      fields: {
        summary: 'Fix login bug',
        description: 'The login form breaks on mobile.',
        status: { name: 'In Progress' },
        issuetype: { name: 'Bug' },
        priority: { name: 'High' },
        assignee: { displayName: 'Alice Smith', emailAddress: 'alice@example.com' },
        labels: ['bug', 'urgent'],
        sprint: { name: 'Sprint 5' },
        created: '2026-01-15T10:00:00.000+0000',
        updated: '2026-01-20T14:30:00.000+0000',
        parent: { key: 'TEAM-10' },
        issuelinks: [
          {
            type: { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
            inwardIssue: { key: 'TEAM-5' },
          },
        ],
      },
    };

    const item = mapIssueToWorkItem(jiraIssue);

    expect(item.id).toBe('TEAM-42');
    expect(item.title).toBe('Fix login bug');
    expect(item.description).toBe('The login form breaks on mobile.');
    expect(item.status).toBe('in progress');
    expect(item.type).toBe('bug');
    expect(item.priority).toBe('high');
    expect(item.assignee).toBe('alice@example.com');
    expect(item.labels).toEqual(['bug', 'urgent']);
    expect(item.iteration).toBe('Sprint 5');
    expect(item.created).toBe('2026-01-15T10:00:00.000+0000');
    expect(item.updated).toBe('2026-01-20T14:30:00.000+0000');
    expect(item.parent).toBe('TEAM-10');
    expect(item.dependsOn).toEqual(['TEAM-5']);
    expect(item.comments).toEqual([]);
  });

  it('handles null/missing fields gracefully', () => {
    const jiraIssue = {
      key: 'TEAM-1',
      fields: {
        summary: 'Empty',
        description: null,
        status: { name: 'To Do' },
        issuetype: { name: 'Task' },
        priority: null,
        assignee: null,
        labels: [],
        sprint: null,
        created: '2026-01-01T00:00:00.000+0000',
        updated: '2026-01-01T00:00:00.000+0000',
        parent: null,
        issuelinks: [],
      },
    };

    const item = mapIssueToWorkItem(jiraIssue);

    expect(item.description).toBe('');
    expect(item.priority).toBe('medium');
    expect(item.assignee).toBe('');
    expect(item.iteration).toBe('');
    expect(item.parent).toBeNull();
    expect(item.dependsOn).toEqual([]);
  });
});

describe('mapCommentToComment', () => {
  it('maps a Jira comment to a tic Comment', () => {
    const jiraComment = {
      author: { displayName: 'Alice', emailAddress: 'alice@example.com' },
      created: '2026-01-15T10:00:00.000+0000',
      body: 'Looks good!',
    };

    const comment = mapCommentToComment(jiraComment);

    expect(comment.author).toBe('alice@example.com');
    expect(comment.date).toBe('2026-01-15T10:00:00.000+0000');
    expect(comment.body).toBe('Looks good!');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/backends/jira/mappers.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```typescript
import type { WorkItem, Comment } from '../../types.js';

export interface JiraIssue {
  key: string;
  fields: {
    summary: string;
    description: string | null;
    status: { name: string };
    issuetype: { name: string };
    priority: { name: string } | null;
    assignee: { displayName: string; emailAddress: string } | null;
    labels: string[];
    sprint: { name: string } | null;
    created: string;
    updated: string;
    parent: { key: string } | null;
    issuelinks: JiraIssueLink[] | undefined;
  };
}

export interface JiraIssueLink {
  type: { name: string; inward: string; outward: string };
  inwardIssue?: { key: string };
  outwardIssue?: { key: string };
}

export interface JiraComment {
  author: { displayName: string; emailAddress: string };
  created: string;
  body: string;
}

export interface JiraSprint {
  id: number;
  name: string;
  state: string;
}

export function mapPriorityToTic(
  priority: string | undefined,
): 'critical' | 'high' | 'medium' | 'low' {
  switch (priority) {
    case 'Highest':
    case 'Critical':
      return 'critical';
    case 'High':
      return 'high';
    case 'Medium':
      return 'medium';
    case 'Low':
    case 'Lowest':
      return 'low';
    default:
      return 'medium';
  }
}

export function mapPriorityToJira(priority: string): string {
  switch (priority) {
    case 'critical':
      return 'Highest';
    case 'high':
      return 'High';
    case 'medium':
      return 'Medium';
    case 'low':
      return 'Low';
    default:
      return 'Medium';
  }
}

export function extractDependsOn(
  links: JiraIssueLink[] | undefined,
): string[] {
  if (!links) return [];
  return links
    .filter(
      (link) =>
        link.type.inward === 'is blocked by' && link.inwardIssue != null,
    )
    .map((link) => link.inwardIssue!.key);
}

export function mapIssueToWorkItem(issue: JiraIssue): WorkItem {
  return {
    id: issue.key,
    title: issue.fields.summary,
    description: issue.fields.description ?? '',
    status: issue.fields.status.name.toLowerCase(),
    type: issue.fields.issuetype.name.toLowerCase(),
    priority: mapPriorityToTic(issue.fields.priority?.name),
    assignee: issue.fields.assignee?.emailAddress ?? '',
    labels: issue.fields.labels,
    iteration: issue.fields.sprint?.name ?? '',
    created: issue.fields.created,
    updated: issue.fields.updated,
    parent: issue.fields.parent?.key ?? null,
    dependsOn: extractDependsOn(issue.fields.issuelinks),
    comments: [],
  };
}

export function mapCommentToComment(comment: JiraComment): Comment {
  return {
    author: comment.author.emailAddress,
    date: comment.created,
    body: comment.body,
  };
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/backends/jira/mappers.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/backends/jira/mappers.ts src/backends/jira/mappers.test.ts
git commit -m "feat(jira): add Jira issue mappers with priority and dependency support"
```

---

## Task 4: JiraBackend Class (`src/backends/jira/index.ts`)

**Files:**
- Create: `src/backends/jira/index.ts`
- Test: `src/backends/jira/jira.test.ts`

This is the main backend class. It follows the same pattern as `GitHubBackend`:
- Constructor verifies auth via `acliExec(['jira', 'auth', 'status'], cwd)`
- Reads Jira config for site/project/boardId
- All methods delegate to `acli`/`acliExec` with appropriate subcommands

**Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JiraBackend } from './index.js';

vi.mock('./acli.js', () => ({
  acli: vi.fn(),
  acliExec: vi.fn(),
}));

vi.mock('./config.js', () => ({
  readJiraConfig: vi.fn(),
}));

import { acli, acliExec } from './acli.js';
import { readJiraConfig } from './config.js';

const mockAcli = vi.mocked(acli);
const mockAcliExec = vi.mocked(acliExec);
const mockReadJiraConfig = vi.mocked(readJiraConfig);

function makeJiraIssue(overrides: {
  key: string;
  summary?: string;
  description?: string | null;
  status?: string;
  issuetype?: string;
  priority?: string | null;
  assignee?: { displayName: string; emailAddress: string } | null;
  labels?: string[];
  sprint?: { name: string } | null;
  created?: string;
  updated?: string;
  parent?: { key: string } | null;
  issuelinks?: any[];
}) {
  return {
    key: overrides.key,
    fields: {
      summary: overrides.summary ?? `Issue ${overrides.key}`,
      description: overrides.description ?? '',
      status: { name: overrides.status ?? 'To Do' },
      issuetype: { name: overrides.issuetype ?? 'Task' },
      priority: overrides.priority !== undefined
        ? (overrides.priority ? { name: overrides.priority } : null)
        : { name: 'Medium' },
      assignee: overrides.assignee ?? null,
      labels: overrides.labels ?? [],
      sprint: overrides.sprint ?? null,
      created: overrides.created ?? '2026-01-01T00:00:00.000+0000',
      updated: overrides.updated ?? '2026-01-02T00:00:00.000+0000',
      parent: overrides.parent ?? null,
      issuelinks: overrides.issuelinks ?? [],
    },
  };
}

describe('JiraBackend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAcliExec.mockReturnValue('');
    mockReadJiraConfig.mockResolvedValue({
      site: 'https://mycompany.atlassian.net',
      project: 'TEAM',
      boardId: 6,
    });
  });

  describe('create', () => {
    it('verifies acli auth on construction', async () => {
      await JiraBackend.create('/repo');
      expect(mockAcliExec).toHaveBeenCalledWith(
        ['jira', 'auth', 'status'],
        '/repo',
      );
    });

    it('throws when acli auth fails', async () => {
      mockAcliExec.mockImplementation(() => {
        throw new Error('not logged in');
      });
      await expect(JiraBackend.create('/repo')).rejects.toThrow();
    });
  });

  describe('getCapabilities', () => {
    it('returns Jira-specific capabilities', async () => {
      const backend = await JiraBackend.create('/repo');
      const caps = backend.getCapabilities();
      expect(caps.relationships).toBe(true);
      expect(caps.customTypes).toBe(false);
      expect(caps.customStatuses).toBe(false);
      expect(caps.iterations).toBe(true);
      expect(caps.comments).toBe(true);
      expect(caps.fields.priority).toBe(true);
      expect(caps.fields.assignee).toBe(true);
      expect(caps.fields.labels).toBe(true);
      expect(caps.fields.parent).toBe(true);
      expect(caps.fields.dependsOn).toBe(true);
    });

    it('disables iterations when boardId not configured', async () => {
      mockReadJiraConfig.mockResolvedValue({
        site: 'https://mycompany.atlassian.net',
        project: 'TEAM',
      });
      const backend = await JiraBackend.create('/repo');
      expect(backend.getCapabilities().iterations).toBe(false);
    });
  });

  describe('getStatuses', () => {
    it('returns statuses from project workflow', async () => {
      const backend = await JiraBackend.create('/repo');
      mockAcli.mockReturnValue([
        { name: 'To Do' },
        { name: 'In Progress' },
        { name: 'Done' },
      ]);
      const statuses = await backend.getStatuses();
      expect(statuses).toEqual(['to do', 'in progress', 'done']);
    });
  });

  describe('getWorkItemTypes', () => {
    it('returns issue types from project config', async () => {
      const backend = await JiraBackend.create('/repo');
      mockAcli.mockReturnValue({
        issueTypes: [
          { name: 'Epic' },
          { name: 'Story' },
          { name: 'Task' },
          { name: 'Bug' },
        ],
      });
      const types = await backend.getWorkItemTypes();
      expect(types).toEqual(['epic', 'story', 'task', 'bug']);
    });
  });

  describe('listWorkItems', () => {
    it('returns all issues mapped to WorkItems', async () => {
      const backend = await JiraBackend.create('/repo');
      mockAcli.mockReturnValue([
        makeJiraIssue({
          key: 'TEAM-1',
          summary: 'First',
          status: 'To Do',
          assignee: { displayName: 'Alice', emailAddress: 'alice@example.com' },
          labels: ['bug'],
        }),
        makeJiraIssue({
          key: 'TEAM-2',
          summary: 'Second',
          status: 'Done',
        }),
      ]);

      const items = await backend.listWorkItems();
      expect(items).toHaveLength(2);
      expect(items[0]!.id).toBe('TEAM-1');
      expect(items[0]!.status).toBe('to do');
      expect(items[0]!.assignee).toBe('alice@example.com');
      expect(items[1]!.id).toBe('TEAM-2');
      expect(items[1]!.status).toBe('done');
    });

    it('filters by sprint when iteration provided', async () => {
      const backend = await JiraBackend.create('/repo');
      // When iteration is provided and boardId is set, uses sprint list-workitems
      mockAcli
        .mockReturnValueOnce([{ id: 42, name: 'Sprint 5', state: 'active' }])
        .mockReturnValueOnce([
          makeJiraIssue({ key: 'TEAM-1', sprint: { name: 'Sprint 5' } }),
        ]);

      const items = await backend.listWorkItems('Sprint 5');
      expect(items).toHaveLength(1);
      expect(items[0]!.id).toBe('TEAM-1');
    });
  });

  describe('getWorkItem', () => {
    it('returns a single issue as WorkItem', async () => {
      const backend = await JiraBackend.create('/repo');
      mockAcli.mockReturnValue(
        makeJiraIssue({
          key: 'TEAM-42',
          summary: 'The issue',
          assignee: { displayName: 'Bob', emailAddress: 'bob@example.com' },
          labels: ['feature'],
        }),
      );

      const item = await backend.getWorkItem('TEAM-42');
      expect(item.id).toBe('TEAM-42');
      expect(item.title).toBe('The issue');
      expect(item.assignee).toBe('bob@example.com');
    });
  });

  describe('createWorkItem', () => {
    it('creates an issue and returns the WorkItem', async () => {
      const backend = await JiraBackend.create('/repo');
      mockAcli
        .mockReturnValueOnce({ key: 'TEAM-10' })
        .mockReturnValueOnce(
          makeJiraIssue({
            key: 'TEAM-10',
            summary: 'New issue',
            issuetype: 'Task',
          }),
        );

      const item = await backend.createWorkItem({
        title: 'New issue',
        type: 'task',
        status: 'to do',
        iteration: '',
        priority: 'medium',
        assignee: '',
        labels: [],
        description: 'Description',
        parent: null,
        dependsOn: [],
      });

      expect(item.id).toBe('TEAM-10');
    });

    it('sets parent when specified', async () => {
      const backend = await JiraBackend.create('/repo');
      mockAcli
        .mockReturnValueOnce({ key: 'TEAM-11' })
        .mockReturnValueOnce(
          makeJiraIssue({ key: 'TEAM-11', parent: { key: 'TEAM-5' } }),
        );

      await backend.createWorkItem({
        title: 'Child issue',
        type: 'task',
        status: 'to do',
        iteration: '',
        priority: 'medium',
        assignee: '',
        labels: [],
        description: '',
        parent: 'TEAM-5',
        dependsOn: [],
      });

      // Verify --parent was passed in create call
      expect(mockAcli).toHaveBeenCalledWith(
        expect.arrayContaining(['--parent', 'TEAM-5']),
        '/repo',
      );
    });

    it('creates dependency links when dependsOn specified', async () => {
      const backend = await JiraBackend.create('/repo');
      mockAcli.mockReturnValueOnce({ key: 'TEAM-12' });
      mockAcliExec.mockReturnValue('');
      mockAcli.mockReturnValueOnce(
        makeJiraIssue({
          key: 'TEAM-12',
          issuelinks: [
            {
              type: { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
              inwardIssue: { key: 'TEAM-3' },
            },
          ],
        }),
      );

      await backend.createWorkItem({
        title: 'Blocked issue',
        type: 'task',
        status: 'to do',
        iteration: '',
        priority: 'medium',
        assignee: '',
        labels: [],
        description: '',
        parent: null,
        dependsOn: ['TEAM-3'],
      });

      // Verify link create was called for the dependency
      expect(mockAcliExec).toHaveBeenCalledWith(
        expect.arrayContaining([
          'jira', 'workitem', 'link', 'create',
          '--out', 'TEAM-3',
          '--in', 'TEAM-12',
          '--type', 'Blocks',
        ]),
        '/repo',
      );
    });
  });

  describe('updateWorkItem', () => {
    it('updates title via edit command', async () => {
      const backend = await JiraBackend.create('/repo');
      mockAcliExec.mockReturnValue('');
      mockAcli.mockReturnValue(
        makeJiraIssue({ key: 'TEAM-5', summary: 'Updated title' }),
      );

      const item = await backend.updateWorkItem('TEAM-5', {
        title: 'Updated title',
      });

      expect(item.title).toBe('Updated title');
      expect(mockAcliExec).toHaveBeenCalledWith(
        expect.arrayContaining([
          'jira', 'workitem', 'edit',
          '--key', 'TEAM-5',
          '--summary', 'Updated title',
        ]),
        '/repo',
      );
    });

    it('transitions status via separate command', async () => {
      const backend = await JiraBackend.create('/repo');
      mockAcliExec.mockReturnValue('');
      mockAcli.mockReturnValue(
        makeJiraIssue({ key: 'TEAM-5', status: 'Done' }),
      );

      await backend.updateWorkItem('TEAM-5', { status: 'done' });

      expect(mockAcliExec).toHaveBeenCalledWith(
        expect.arrayContaining([
          'jira', 'workitem', 'transition',
          '--key', 'TEAM-5',
          '--status', 'Done',
        ]),
        '/repo',
      );
    });

    it('assigns via separate command', async () => {
      const backend = await JiraBackend.create('/repo');
      mockAcliExec.mockReturnValue('');
      mockAcli.mockReturnValue(
        makeJiraIssue({
          key: 'TEAM-5',
          assignee: { displayName: 'Alice', emailAddress: 'alice@example.com' },
        }),
      );

      await backend.updateWorkItem('TEAM-5', { assignee: 'alice@example.com' });

      expect(mockAcliExec).toHaveBeenCalledWith(
        expect.arrayContaining([
          'jira', 'workitem', 'assign',
          '--key', 'TEAM-5',
          '--assignee', 'alice@example.com',
        ]),
        '/repo',
      );
    });
  });

  describe('deleteWorkItem', () => {
    it('deletes a work item', async () => {
      const backend = await JiraBackend.create('/repo');
      mockAcliExec.mockReturnValue('');
      await backend.deleteWorkItem('TEAM-7');
      expect(mockAcliExec).toHaveBeenCalledWith(
        ['jira', 'workitem', 'delete', '--key', 'TEAM-7', '--yes'],
        '/repo',
      );
    });
  });

  describe('addComment', () => {
    it('adds a comment and returns it', async () => {
      const backend = await JiraBackend.create('/repo');
      mockAcliExec.mockReturnValue('');

      const comment = await backend.addComment('TEAM-3', {
        author: 'alice@example.com',
        body: 'This is a comment.',
      });

      expect(mockAcliExec).toHaveBeenCalledWith(
        [
          'jira', 'workitem', 'comment', 'create',
          '--key', 'TEAM-3',
          '--body', 'This is a comment.',
        ],
        '/repo',
      );
      expect(comment.author).toBe('alice@example.com');
      expect(comment.body).toBe('This is a comment.');
    });
  });

  describe('getChildren', () => {
    it('returns items whose parent matches the given id', async () => {
      const backend = await JiraBackend.create('/repo');
      mockAcli.mockReturnValue([
        makeJiraIssue({ key: 'TEAM-2', parent: { key: 'TEAM-1' } }),
        makeJiraIssue({ key: 'TEAM-3', parent: { key: 'TEAM-1' } }),
      ]);

      const children = await backend.getChildren('TEAM-1');
      expect(children).toHaveLength(2);
    });
  });

  describe('getDependents', () => {
    it('returns items that depend on the given id', async () => {
      const backend = await JiraBackend.create('/repo');
      mockAcli.mockReturnValue([
        makeJiraIssue({
          key: 'TEAM-5',
          issuelinks: [
            {
              type: { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
              inwardIssue: { key: 'TEAM-3' },
            },
          ],
        }),
      ]);

      const dependents = await backend.getDependents('TEAM-3');
      expect(dependents).toHaveLength(1);
      expect(dependents[0]!.id).toBe('TEAM-5');
    });
  });

  describe('getItemUrl', () => {
    it('returns the Jira browse URL', async () => {
      const backend = await JiraBackend.create('/repo');
      expect(backend.getItemUrl('TEAM-42')).toBe(
        'https://mycompany.atlassian.net/browse/TEAM-42',
      );
    });
  });

  describe('openItem', () => {
    it('opens the issue in the browser', async () => {
      const backend = await JiraBackend.create('/repo');
      mockAcliExec.mockReturnValue('');
      await backend.openItem('TEAM-5');
      expect(mockAcliExec).toHaveBeenCalledWith(
        ['jira', 'workitem', 'view', 'TEAM-5', '--web'],
        '/repo',
      );
    });
  });

  describe('getIterations', () => {
    it('returns sprint names from board', async () => {
      const backend = await JiraBackend.create('/repo');
      mockAcli.mockReturnValue([
        { id: 1, name: 'Sprint 1', state: 'closed' },
        { id: 2, name: 'Sprint 2', state: 'active' },
        { id: 3, name: 'Sprint 3', state: 'future' },
      ]);
      const iterations = await backend.getIterations();
      expect(iterations).toEqual(['Sprint 1', 'Sprint 2', 'Sprint 3']);
    });

    it('returns empty array when no boardId', async () => {
      mockReadJiraConfig.mockResolvedValue({
        site: 'https://mycompany.atlassian.net',
        project: 'TEAM',
      });
      const backend = await JiraBackend.create('/repo');
      expect(await backend.getIterations()).toEqual([]);
    });
  });

  describe('getCurrentIteration', () => {
    it('returns active sprint name', async () => {
      const backend = await JiraBackend.create('/repo');
      mockAcli.mockReturnValue([
        { id: 1, name: 'Sprint 1', state: 'closed' },
        { id: 2, name: 'Sprint 2', state: 'active' },
      ]);
      expect(await backend.getCurrentIteration()).toBe('Sprint 2');
    });

    it('returns empty string when no active sprint', async () => {
      const backend = await JiraBackend.create('/repo');
      mockAcli.mockReturnValue([
        { id: 1, name: 'Sprint 1', state: 'closed' },
      ]);
      expect(await backend.getCurrentIteration()).toBe('');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/backends/jira/jira.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```typescript
import { BaseBackend } from '../types.js';
import type { BackendCapabilities } from '../types.js';
import type {
  WorkItem,
  NewWorkItem,
  NewComment,
  Comment,
} from '../../types.js';
import { acli, acliExec } from './acli.js';
import { readJiraConfig } from './config.js';
import type { JiraConfig } from './config.js';
import { mapIssueToWorkItem, mapCommentToComment, mapPriorityToJira } from './mappers.js';
import type { JiraIssue, JiraComment, JiraSprint } from './mappers.js';

export class JiraBackend extends BaseBackend {
  private cwd: string;
  private config: JiraConfig;

  private constructor(cwd: string, config: JiraConfig) {
    super();
    this.cwd = cwd;
    this.config = config;
  }

  static async create(cwd: string): Promise<JiraBackend> {
    acliExec(['jira', 'auth', 'status'], cwd);
    const config = await readJiraConfig(cwd);
    return new JiraBackend(cwd, config);
  }

  getCapabilities(): BackendCapabilities {
    return {
      relationships: true,
      customTypes: false,
      customStatuses: false,
      iterations: this.config.boardId != null,
      comments: true,
      fields: {
        priority: true,
        assignee: true,
        labels: true,
        parent: true,
        dependsOn: true,
      },
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getStatuses(): Promise<string[]> {
    const statuses = acli<{ name: string }[]>(
      [
        'jira', 'workitem', 'search',
        '--jql', `project = ${this.config.project}`,
        '--fields', 'status',
        '--json',
        '--limit', '100',
      ],
      this.cwd,
    );
    const names = new Set(statuses.map((s) => s.name.toLowerCase()));
    return [...names];
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getWorkItemTypes(): Promise<string[]> {
    const project = acli<{ issueTypes: { name: string }[] }>(
      ['jira', 'project', 'view', '--key', this.config.project, '--json'],
      this.cwd,
    );
    return project.issueTypes.map((t) => t.name.toLowerCase());
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getAssignees(): Promise<string[]> {
    try {
      const issues = acli<JiraIssue[]>(
        [
          'jira', 'workitem', 'search',
          '--jql', `project = ${this.config.project} AND assignee IS NOT EMPTY`,
          '--fields', 'assignee',
          '--json',
          '--limit', '100',
        ],
        this.cwd,
      );
      const assignees = new Set(
        issues
          .map((i) => i.fields.assignee?.emailAddress)
          .filter((a): a is string => a != null),
      );
      return [...assignees];
    } catch {
      return [];
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getIterations(): Promise<string[]> {
    if (!this.config.boardId) return [];
    const sprints = acli<JiraSprint[]>(
      [
        'jira', 'board', 'list-sprints',
        '--id', String(this.config.boardId),
        '--json',
        '--paginate',
      ],
      this.cwd,
    );
    return sprints.map((s) => s.name);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getCurrentIteration(): Promise<string> {
    if (!this.config.boardId) return '';
    const sprints = acli<JiraSprint[]>(
      [
        'jira', 'board', 'list-sprints',
        '--id', String(this.config.boardId),
        '--state', 'active',
        '--json',
      ],
      this.cwd,
    );
    return sprints.length > 0 ? sprints[0]!.name : '';
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async setCurrentIteration(_name: string): Promise<void> {
    // No-op — sprints are managed in Jira, current sprint is the active one
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async listWorkItems(iteration?: string): Promise<WorkItem[]> {
    if (iteration && this.config.boardId) {
      // Find sprint ID by name, then list its work items
      const sprints = acli<JiraSprint[]>(
        [
          'jira', 'board', 'list-sprints',
          '--id', String(this.config.boardId),
          '--json',
          '--paginate',
        ],
        this.cwd,
      );
      const sprint = sprints.find((s) => s.name === iteration);
      if (!sprint) return [];

      const issues = acli<JiraIssue[]>(
        [
          'jira', 'sprint', 'list-workitems',
          '--board', String(this.config.boardId),
          '--sprint', String(sprint.id),
          '--fields', '*all',
          '--json',
          '--paginate',
        ],
        this.cwd,
      );
      return issues.map(mapIssueToWorkItem);
    }

    const issues = acli<JiraIssue[]>(
      [
        'jira', 'workitem', 'search',
        '--jql', `project = ${this.config.project} ORDER BY updated DESC`,
        '--fields', '*all',
        '--json',
        '--paginate',
      ],
      this.cwd,
    );
    let items = issues.map(mapIssueToWorkItem);
    if (iteration) {
      items = items.filter((i) => i.iteration === iteration);
    }
    return items;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getWorkItem(id: string): Promise<WorkItem> {
    const issue = acli<JiraIssue>(
      ['jira', 'workitem', 'view', id, '--fields', '*all', '--json'],
      this.cwd,
    );
    // Fetch comments separately
    try {
      const comments = acli<JiraComment[]>(
        ['jira', 'workitem', 'comment', 'list', '--key', id, '--json'],
        this.cwd,
      );
      const item = mapIssueToWorkItem(issue);
      item.comments = comments.map(mapCommentToComment);
      return item;
    } catch {
      return mapIssueToWorkItem(issue);
    }
  }

  async createWorkItem(data: NewWorkItem): Promise<WorkItem> {
    this.validateFields(data);

    const args = [
      'jira', 'workitem', 'create',
      '--summary', data.title,
      '--project', this.config.project,
      '--type', data.type.charAt(0).toUpperCase() + data.type.slice(1),
      '--json',
    ];

    if (data.description) {
      args.push('--description', data.description);
    }
    if (data.assignee) {
      args.push('--assignee', data.assignee);
    }
    if (data.labels.length > 0) {
      args.push('--label', data.labels.join(','));
    }
    if (data.parent) {
      args.push('--parent', data.parent);
    }

    const created = acli<{ key: string }>(args, this.cwd);

    // Create dependency links
    for (const dep of data.dependsOn) {
      acliExec(
        [
          'jira', 'workitem', 'link', 'create',
          '--out', dep,
          '--in', created.key,
          '--type', 'Blocks',
        ],
        this.cwd,
      );
    }

    return this.getWorkItem(created.key);
  }

  async updateWorkItem(
    id: string,
    data: Partial<WorkItem>,
  ): Promise<WorkItem> {
    this.validateFields(data);

    // Status change via transition (separate command)
    if (data.status !== undefined) {
      const statusTitle = data.status
        .split(' ')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
      acliExec(
        [
          'jira', 'workitem', 'transition',
          '--key', id,
          '--status', statusTitle,
          '--yes',
        ],
        this.cwd,
      );
    }

    // Assignee change via assign (separate command)
    if (data.assignee !== undefined) {
      if (data.assignee) {
        acliExec(
          [
            'jira', 'workitem', 'assign',
            '--key', id,
            '--assignee', data.assignee,
          ],
          this.cwd,
        );
      } else {
        acliExec(
          [
            'jira', 'workitem', 'assign',
            '--key', id,
            '--remove-assignee',
          ],
          this.cwd,
        );
      }
    }

    // Field edits via edit command
    const editArgs = ['jira', 'workitem', 'edit', '--key', id];
    let hasEdits = false;

    if (data.title !== undefined) {
      editArgs.push('--summary', data.title);
      hasEdits = true;
    }
    if (data.description !== undefined) {
      editArgs.push('--description', data.description);
      hasEdits = true;
    }
    if (data.labels !== undefined) {
      editArgs.push('--labels', data.labels.join(','));
      hasEdits = true;
    }
    if (data.type !== undefined) {
      editArgs.push(
        '--type',
        data.type.charAt(0).toUpperCase() + data.type.slice(1),
      );
      hasEdits = true;
    }

    if (hasEdits) {
      editArgs.push('--yes');
      acliExec(editArgs, this.cwd);
    }

    return this.getWorkItem(id);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async deleteWorkItem(id: string): Promise<void> {
    acliExec(
      ['jira', 'workitem', 'delete', '--key', id, '--yes'],
      this.cwd,
    );
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async addComment(workItemId: string, comment: NewComment): Promise<Comment> {
    acliExec(
      [
        'jira', 'workitem', 'comment', 'create',
        '--key', workItemId,
        '--body', comment.body,
      ],
      this.cwd,
    );
    return {
      author: comment.author,
      date: new Date().toISOString(),
      body: comment.body,
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getChildren(id: string): Promise<WorkItem[]> {
    const issues = acli<JiraIssue[]>(
      [
        'jira', 'workitem', 'search',
        '--jql', `parent = ${id}`,
        '--fields', '*all',
        '--json',
        '--paginate',
      ],
      this.cwd,
    );
    return issues.map(mapIssueToWorkItem);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getDependents(id: string): Promise<WorkItem[]> {
    const issues = acli<JiraIssue[]>(
      [
        'jira', 'workitem', 'search',
        '--jql', `issue in linkedIssues("${id}","is blocked by")`,
        '--fields', '*all',
        '--json',
        '--paginate',
      ],
      this.cwd,
    );
    return issues.map(mapIssueToWorkItem);
  }

  getItemUrl(id: string): string {
    return `${this.config.site}/browse/${id}`;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async openItem(id: string): Promise<void> {
    acliExec(['jira', 'workitem', 'view', id, '--web'], this.cwd);
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/backends/jira/jira.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/backends/jira/index.ts src/backends/jira/jira.test.ts
git commit -m "feat(jira): add JiraBackend class with full Backend interface"
```

---

## Task 5: Factory Integration

**Files:**
- Modify: `src/backends/factory.ts`
- Modify: `src/backends/factory.test.ts`

**Step 1: Update the factory test**

In `src/backends/factory.test.ts`:

1. Change the VALID_BACKENDS test:
```typescript
it('contains the five known backends', () => {
  expect(VALID_BACKENDS).toEqual(['local', 'github', 'gitlab', 'azure', 'jira']);
});
```

2. Remove or update the "throws for unknown backend" test (it currently uses `'jira'` as the unknown backend):
```typescript
it('throws for unknown backend values', async () => {
  await writeConfig(tmpDir, { ...defaultConfig, backend: 'foobar' });
  await expect(createBackend(tmpDir)).rejects.toThrow('Unknown backend');
});
```

3. Add a new test for Jira backend creation:
```typescript
it('attempts to create JiraBackend when backend is jira', async () => {
  await writeConfig(tmpDir, {
    ...defaultConfig,
    backend: 'jira',
    jira: {
      site: 'https://mycompany.atlassian.net',
      project: 'TEAM',
    },
  });
  try {
    await createBackend(tmpDir);
  } catch (e) {
    expect((e as Error).message).not.toContain('not yet implemented');
    expect((e as Error).message).not.toContain('Unknown backend');
  }
});
```

4. Add a sync test:
```typescript
it('returns LocalBackend and SyncManager for jira backend', async () => {
  await writeConfig(tmpDir, {
    ...defaultConfig,
    backend: 'jira',
    jira: {
      site: 'https://mycompany.atlassian.net',
      project: 'TEAM',
    },
  });
  try {
    const { backend, syncManager } = await createBackendWithSync(tmpDir);
    expect(backend).toBeInstanceOf(LocalBackend);
    expect(syncManager).toBeInstanceOf(SyncManager);
  } catch (e) {
    expect((e as Error).message).not.toContain('Unknown backend');
  }
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/backends/factory.test.ts`
Expected: FAIL — VALID_BACKENDS doesn't include 'jira', and createBackend throws "Unknown backend" for jira

**Step 3: Update `src/backends/factory.ts`**

1. Add import:
```typescript
import { JiraBackend } from './jira/index.js';
```

2. Update VALID_BACKENDS:
```typescript
export const VALID_BACKENDS = ['local', 'github', 'gitlab', 'azure', 'jira'] as const;
```

3. Add case in `createBackend`:
```typescript
case 'jira':
  return JiraBackend.create(root);
```

4. Add case in `createBackendWithSync`:
```typescript
case 'jira':
  remote = await JiraBackend.create(root);
  break;
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/backends/factory.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/backends/factory.ts src/backends/factory.test.ts
git commit -m "feat(jira): register Jira backend in factory"
```

---

## Task 6: CLI Config Validation Update

**Files:**
- Modify: `src/cli/__tests__/config.test.ts`

The config validation test currently expects `jira` to be rejected as invalid. Now that `jira` is in `VALID_BACKENDS`, this test needs updating.

**Step 1: Update the test**

Change the test at line 50 from:

```typescript
it('validates backend values', async () => {
  await expect(runConfigSet(tmpDir, 'backend', 'jira')).rejects.toThrow(
    'Invalid backend',
  );
});
```

To:

```typescript
it('validates backend values', async () => {
  await expect(runConfigSet(tmpDir, 'backend', 'foobar')).rejects.toThrow(
    'Invalid backend',
  );
});

it('accepts jira as a valid backend', async () => {
  await runConfigSet(tmpDir, 'backend', 'jira');
  const config = await readConfig(tmpDir);
  expect(config.backend).toBe('jira');
});
```

**Step 2: Run test to verify it passes**

Run: `npx vitest run src/cli/__tests__/config.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add src/cli/__tests__/config.test.ts
git commit -m "test: update config tests to accept jira as valid backend"
```

---

## Task 7: Full Test Suite + Lint + Build

**Step 1: Run the full test suite**

Run: `npm test`
Expected: All tests pass

**Step 2: Run lint**

Run: `npm run lint`
Expected: No lint errors

**Step 3: Run build**

Run: `npm run build`
Expected: Clean compilation

**Step 4: Fix any issues found in steps 1-3**

If there are type errors, lint issues, or test failures, fix them before proceeding.

**Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix(jira): resolve lint and build issues"
```

---

## Task 8: Update Work Item #3

**Step 1: Update the Jira feature request status**

Close or update `.tic/items/3.md` to mark the feature as implemented.

**Step 2: Final commit**

```bash
git add .tic/items/3.md
git commit -m "docs: mark Jira backend feature as implemented"
```

---

## Summary of Files

### New files (4 source + 4 test = 8 total)
- `src/backends/jira/acli.ts` — ACLI CLI wrapper
- `src/backends/jira/acli.test.ts`
- `src/backends/jira/config.ts` — Jira config reader
- `src/backends/jira/config.test.ts`
- `src/backends/jira/mappers.ts` — Jira → WorkItem mappers
- `src/backends/jira/mappers.test.ts`
- `src/backends/jira/index.ts` — JiraBackend class
- `src/backends/jira/jira.test.ts`

### Modified files (4)
- `src/backends/local/config.ts` — Add `jira?` to Config interface
- `src/backends/factory.ts` — Add 'jira' to VALID_BACKENDS, add case in createBackend/createBackendWithSync
- `src/backends/factory.test.ts` — Update tests for Jira backend
- `src/cli/__tests__/config.test.ts` — Update validation test to accept 'jira'

### ACLI Commands Used

| Operation | Command |
|-----------|---------|
| Auth check | `acli jira auth status` |
| Search issues | `acli jira workitem search --jql "..." --fields *all --json --paginate` |
| View issue | `acli jira workitem view KEY --fields *all --json` |
| Create issue | `acli jira workitem create --summary --project --type [--parent] [--label] --json` |
| Edit issue | `acli jira workitem edit --key KEY --summary --description [--labels] [--type] --yes` |
| Transition | `acli jira workitem transition --key KEY --status "Status" --yes` |
| Assign | `acli jira workitem assign --key KEY --assignee email` |
| Delete | `acli jira workitem delete --key KEY --yes` |
| Comment | `acli jira workitem comment create --key KEY --body "..."` |
| List comments | `acli jira workitem comment list --key KEY --json` |
| Link (deps) | `acli jira workitem link create --out KEY1 --in KEY2 --type Blocks` |
| Children | `acli jira workitem search --jql "parent = KEY" --fields *all --json` |
| Dependents | `acli jira workitem search --jql 'issue in linkedIssues("KEY","is blocked by")' --fields *all --json` |
| List sprints | `acli jira board list-sprints --id N --json --paginate` |
| Active sprint | `acli jira board list-sprints --id N --state active --json` |
| Sprint items | `acli jira sprint list-workitems --board N --sprint S --fields *all --json --paginate` |
| Project info | `acli jira project view --key PROJ --json` |
| Open in browser | `acli jira workitem view KEY --web` |
