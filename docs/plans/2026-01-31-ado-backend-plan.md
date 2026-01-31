# Azure DevOps Backend Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an Azure DevOps backend to tic that wraps the `az boards` CLI, supporting work items, iterations, comments, parent-child relationships, and predecessor dependencies.

**Architecture:** Follows the same pattern as the GitLab backend: a CLI wrapper module (`az.ts`), data mappers (`mappers.ts`), a remote URL parser (`remote.ts`), and the main backend class (`index.ts`) extending `BaseBackend`. Uses `az boards` for most operations and `az devops invoke` for batch fetching and comments. HTML descriptions are converted to markdown via the `turndown` library.

**Tech Stack:** TypeScript, `az` CLI (`azure-devops` extension), `turndown` for HTML-to-markdown, Vitest for testing.

**Design doc:** `docs/plans/2026-01-31-ado-backend-design.md`

---

### Task 1: Install turndown dependency

**Files:**
- Modify: `package.json`

**Step 1: Install turndown and its types**

Run:
```bash
cd /Users/skrug/PycharmProjects/tic/.worktrees/ado-backend
npm install turndown
npm install -D @types/turndown
```

**Step 2: Verify installation**

Run: `npm ls turndown`
Expected: `turndown@x.x.x` listed

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(ado): add turndown dependency for HTML-to-markdown conversion"
```

---

### Task 2: Remote URL parser (`remote.ts`)

**Files:**
- Create: `src/backends/ado/remote.ts`
- Create: `src/backends/ado/remote.test.ts`

**Step 1: Write the failing tests**

Create `src/backends/ado/remote.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execSync } from 'node:child_process';
import { parseAdoRemote } from './remote.js';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

const mockExecSync = vi.mocked(execSync);

describe('parseAdoRemote', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('extracts org and project from HTTPS dev.azure.com remote', () => {
    mockExecSync.mockReturnValue(
      'origin\thttps://dev.azure.com/contoso/WebApp/_git/frontend (fetch)\n',
    );
    expect(parseAdoRemote('/tmp')).toEqual({
      org: 'contoso',
      project: 'WebApp',
    });
  });

  it('extracts org and project from SSH remote', () => {
    mockExecSync.mockReturnValue(
      'origin\tgit@ssh.dev.azure.com:v3/contoso/WebApp/frontend (fetch)\n',
    );
    expect(parseAdoRemote('/tmp')).toEqual({
      org: 'contoso',
      project: 'WebApp',
    });
  });

  it('extracts org and project from legacy visualstudio.com remote', () => {
    mockExecSync.mockReturnValue(
      'origin\thttps://contoso.visualstudio.com/WebApp/_git/frontend (fetch)\n',
    );
    expect(parseAdoRemote('/tmp')).toEqual({
      org: 'contoso',
      project: 'WebApp',
    });
  });

  it('URL-decodes project names with spaces', () => {
    mockExecSync.mockReturnValue(
      'origin\thttps://dev.azure.com/contoso/My%20Web%20App/_git/frontend (fetch)\n',
    );
    expect(parseAdoRemote('/tmp')).toEqual({
      org: 'contoso',
      project: 'My Web App',
    });
  });

  it('URL-decodes project names in legacy format', () => {
    mockExecSync.mockReturnValue(
      'origin\thttps://contoso.visualstudio.com/My%20Project/_git/repo (fetch)\n',
    );
    expect(parseAdoRemote('/tmp')).toEqual({
      org: 'contoso',
      project: 'My Project',
    });
  });

  it('handles SSH with spaces in project name', () => {
    mockExecSync.mockReturnValue(
      'origin\tgit@ssh.dev.azure.com:v3/contoso/My Web App/frontend (fetch)\n',
    );
    expect(parseAdoRemote('/tmp')).toEqual({
      org: 'contoso',
      project: 'My Web App',
    });
  });

  it('throws when no ADO remote found', () => {
    mockExecSync.mockReturnValue(
      'origin\tgit@github.com:user/repo.git (fetch)\n',
    );
    expect(() => parseAdoRemote('/tmp')).toThrow(
      'No Azure DevOps remote found',
    );
  });

  it('throws when git command fails', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('not a git repository');
    });
    expect(() => parseAdoRemote('/tmp')).toThrow();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/backends/ado/remote.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

Create `src/backends/ado/remote.ts`:

```typescript
import { execSync } from 'node:child_process';

export interface AdoRemoteInfo {
  org: string;
  project: string;
}

export function parseAdoRemote(cwd: string): AdoRemoteInfo {
  const output = execSync('git remote -v', {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const lines = output.split('\n');
  for (const line of lines) {
    // HTTPS: https://dev.azure.com/{org}/{project}/_git/{repo}
    const httpsMatch = line.match(
      /dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\//,
    );
    if (httpsMatch) {
      return {
        org: httpsMatch[1]!,
        project: decodeURIComponent(httpsMatch[2]!),
      };
    }

    // SSH: git@ssh.dev.azure.com:v3/{org}/{project}/{repo}
    const sshMatch = line.match(
      /ssh\.dev\.azure\.com:v3\/([^/]+)\/(.+)\/[^/]+/,
    );
    if (sshMatch) {
      return {
        org: sshMatch[1]!,
        project: sshMatch[2]!,
      };
    }

    // Legacy: https://{org}.visualstudio.com/{project}/_git/{repo}
    const legacyMatch = line.match(
      /([^/.]+)\.visualstudio\.com\/([^/]+)\/_git\//,
    );
    if (legacyMatch) {
      return {
        org: legacyMatch[1]!,
        project: decodeURIComponent(legacyMatch[2]!),
      };
    }
  }

  throw new Error('No Azure DevOps remote found in git remotes');
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/backends/ado/remote.test.ts`
Expected: All 8 tests PASS

**Step 5: Commit**

```bash
git add src/backends/ado/remote.ts src/backends/ado/remote.test.ts
git commit -m "feat(ado): add remote URL parser for Azure DevOps"
```

---

### Task 3: CLI wrapper (`az.ts`)

**Files:**
- Create: `src/backends/ado/az.ts`
- Create: `src/backends/ado/az.test.ts`

**Step 1: Write the failing tests**

Create `src/backends/ado/az.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { az, azExec, azInvoke } from './az.js';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

const mockExecFileSync = vi.mocked(execFileSync);

describe('az', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses JSON output from az command', () => {
    mockExecFileSync.mockReturnValue('[{"id": 1, "fields": {}}]');
    const result = az<{ id: number }[]>(
      ['boards', 'work-item', 'show', '--id', '1'],
      '/tmp',
    );
    expect(result).toEqual([{ id: 1, fields: {} }]);
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'az',
      ['boards', 'work-item', 'show', '--id', '1', '-o', 'json'],
      { cwd: '/tmp', encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
  });

  it('throws on az command failure', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('az: command failed');
    });
    expect(() => az(['boards', 'query'], '/tmp')).toThrow();
  });
});

describe('azExec', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns raw string output', () => {
    mockExecFileSync.mockReturnValue('Deleted work item 42\n');
    const result = azExec(
      ['boards', 'work-item', 'delete', '--id', '42', '--yes'],
      '/tmp',
    );
    expect(result).toBe('Deleted work item 42\n');
  });
});

describe('azInvoke', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls az devops invoke with correct args and parses JSON', () => {
    mockExecFileSync.mockReturnValue('{"count": 2, "value": []}');
    const result = azInvoke<{ count: number }>(
      {
        area: 'wit',
        resource: 'workitemsbatch',
        httpMethod: 'POST',
        body: { ids: [1, 2] },
      },
      '/tmp',
    );
    expect(result).toEqual({ count: 2, value: [] });
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'az',
      expect.arrayContaining([
        'devops',
        'invoke',
        '--area',
        'wit',
        '--resource',
        'workitemsbatch',
        '--http-method',
        'POST',
      ]),
      expect.objectContaining({ cwd: '/tmp' }),
    );
  });

  it('passes route parameters when provided', () => {
    mockExecFileSync.mockReturnValue('{"comments": []}');
    azInvoke<unknown>(
      {
        area: 'wit',
        resource: 'comments',
        routeParameters: 'workItemId=42',
      },
      '/tmp',
    );
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'az',
      expect.arrayContaining(['--route-parameters', 'workItemId=42']),
      expect.anything(),
    );
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/backends/ado/az.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

Create `src/backends/ado/az.ts`:

```typescript
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function az<T>(args: string[], cwd: string): T {
  const result = execFileSync('az', [...args, '-o', 'json'], {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return JSON.parse(result) as T;
}

export function azExec(args: string[], cwd: string): string {
  return execFileSync('az', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

export interface AzInvokeOptions {
  area: string;
  resource: string;
  httpMethod?: string;
  routeParameters?: string;
  body?: unknown;
  apiVersion?: string;
}

export function azInvoke<T>(options: AzInvokeOptions, cwd: string): T {
  const args = [
    'devops',
    'invoke',
    '--area',
    options.area,
    '--resource',
    options.resource,
  ];

  if (options.httpMethod) {
    args.push('--http-method', options.httpMethod);
  }
  if (options.routeParameters) {
    args.push('--route-parameters', options.routeParameters);
  }
  if (options.apiVersion) {
    args.push('--api-version', options.apiVersion);
  }

  let tmpFile: string | undefined;
  if (options.body) {
    tmpFile = path.join(os.tmpdir(), `tic-az-${Date.now()}.json`);
    fs.writeFileSync(tmpFile, JSON.stringify(options.body));
    args.push('--in-file', tmpFile);
  }

  try {
    const result = execFileSync('az', [...args, '-o', 'json'], {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return JSON.parse(result) as T;
  } finally {
    if (tmpFile) {
      fs.unlinkSync(tmpFile);
    }
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/backends/ado/az.test.ts`
Expected: All 5 tests PASS

**Step 5: Commit**

```bash
git add src/backends/ado/az.ts src/backends/ado/az.test.ts
git commit -m "feat(ado): add az CLI wrapper with invoke support"
```

---

### Task 4: Data mappers (`mappers.ts`)

**Files:**
- Create: `src/backends/ado/mappers.ts`
- Create: `src/backends/ado/mappers.test.ts`

**Step 1: Write the failing tests**

Create `src/backends/ado/mappers.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  mapWorkItemToWorkItem,
  mapCommentToComment,
  mapPriorityToTic,
  mapPriorityToAdo,
  parseTags,
  formatTags,
  extractParent,
  extractPredecessors,
} from './mappers.js';

const sampleAdoWorkItem = {
  id: 42,
  fields: {
    'System.Title': 'Fix login bug',
    'System.WorkItemType': 'User Story',
    'System.State': 'Active',
    'System.IterationPath': 'MyProject\\Sprint 1',
    'Microsoft.VSTS.Common.Priority': 2,
    'System.AssignedTo': { displayName: 'Alice Smith', uniqueName: 'alice@example.com' },
    'System.Tags': 'bug; frontend; urgent',
    'System.Description': '<p>The login form breaks.</p>',
    'System.CreatedDate': '2026-01-15T10:00:00Z',
    'System.ChangedDate': '2026-01-20T14:30:00Z',
  },
  relations: [
    {
      rel: 'System.LinkTypes.Hierarchy-Reverse',
      url: 'https://dev.azure.com/contoso/_apis/wit/workItems/10',
      attributes: {},
    },
    {
      rel: 'System.LinkTypes.Dependency-Reverse',
      url: 'https://dev.azure.com/contoso/_apis/wit/workItems/20',
      attributes: {},
    },
    {
      rel: 'System.LinkTypes.Dependency-Reverse',
      url: 'https://dev.azure.com/contoso/_apis/wit/workItems/21',
      attributes: {},
    },
  ],
};

describe('mapPriorityToTic', () => {
  it('maps 1 to critical', () => expect(mapPriorityToTic(1)).toBe('critical'));
  it('maps 2 to high', () => expect(mapPriorityToTic(2)).toBe('high'));
  it('maps 3 to medium', () => expect(mapPriorityToTic(3)).toBe('medium'));
  it('maps 4 to low', () => expect(mapPriorityToTic(4)).toBe('low'));
  it('defaults to medium for undefined', () =>
    expect(mapPriorityToTic(undefined)).toBe('medium'));
});

describe('mapPriorityToAdo', () => {
  it('maps critical to 1', () => expect(mapPriorityToAdo('critical')).toBe(1));
  it('maps high to 2', () => expect(mapPriorityToAdo('high')).toBe(2));
  it('maps medium to 3', () => expect(mapPriorityToAdo('medium')).toBe(3));
  it('maps low to 4', () => expect(mapPriorityToAdo('low')).toBe(4));
});

describe('parseTags', () => {
  it('splits semicolon-separated tags', () => {
    expect(parseTags('bug; frontend; urgent')).toEqual([
      'bug',
      'frontend',
      'urgent',
    ]);
  });

  it('returns empty array for empty string', () => {
    expect(parseTags('')).toEqual([]);
  });

  it('returns empty array for undefined', () => {
    expect(parseTags(undefined)).toEqual([]);
  });

  it('trims whitespace from tags', () => {
    expect(parseTags('  a ;  b  ')).toEqual(['a', 'b']);
  });
});

describe('formatTags', () => {
  it('joins tags with semicolon and space', () => {
    expect(formatTags(['bug', 'frontend'])).toBe('bug; frontend');
  });

  it('returns empty string for empty array', () => {
    expect(formatTags([])).toBe('');
  });
});

describe('extractParent', () => {
  it('extracts parent ID from Hierarchy-Reverse relation', () => {
    expect(extractParent(sampleAdoWorkItem.relations)).toBe('10');
  });

  it('returns null when no parent relation exists', () => {
    expect(extractParent([])).toBeNull();
    expect(extractParent(undefined)).toBeNull();
  });
});

describe('extractPredecessors', () => {
  it('extracts predecessor IDs from Dependency-Reverse relations', () => {
    expect(extractPredecessors(sampleAdoWorkItem.relations)).toEqual([
      '20',
      '21',
    ]);
  });

  it('returns empty array when no predecessor relations', () => {
    expect(extractPredecessors([])).toEqual([]);
    expect(extractPredecessors(undefined)).toEqual([]);
  });
});

describe('mapWorkItemToWorkItem', () => {
  it('maps a full ADO work item to a tic WorkItem', () => {
    const item = mapWorkItemToWorkItem(sampleAdoWorkItem);

    expect(item.id).toBe('42');
    expect(item.title).toBe('Fix login bug');
    expect(item.type).toBe('User Story');
    expect(item.status).toBe('Active');
    expect(item.iteration).toBe('MyProject\\Sprint 1');
    expect(item.priority).toBe('high');
    expect(item.assignee).toBe('Alice Smith');
    expect(item.labels).toEqual(['bug', 'frontend', 'urgent']);
    expect(item.description).toBe('The login form breaks.');
    expect(item.created).toBe('2026-01-15T10:00:00Z');
    expect(item.updated).toBe('2026-01-20T14:30:00Z');
    expect(item.parent).toBe('10');
    expect(item.dependsOn).toEqual(['20', '21']);
    expect(item.comments).toEqual([]);
  });

  it('handles missing optional fields', () => {
    const minimal = {
      id: 1,
      fields: {
        'System.Title': 'Minimal item',
        'System.WorkItemType': 'Task',
        'System.State': 'New',
        'System.IterationPath': 'MyProject',
        'System.CreatedDate': '2026-01-01T00:00:00Z',
        'System.ChangedDate': '2026-01-01T00:00:00Z',
      },
    };

    const item = mapWorkItemToWorkItem(minimal);

    expect(item.id).toBe('1');
    expect(item.priority).toBe('medium');
    expect(item.assignee).toBe('');
    expect(item.labels).toEqual([]);
    expect(item.description).toBe('');
    expect(item.parent).toBeNull();
    expect(item.dependsOn).toEqual([]);
  });
});

describe('mapCommentToComment', () => {
  it('maps an ADO comment to a tic Comment', () => {
    const adoComment = {
      createdBy: { displayName: 'Alice Smith' },
      createdDate: '2026-01-16T09:00:00Z',
      text: '<p>I can reproduce this.</p>',
    };

    const comment = mapCommentToComment(adoComment);

    expect(comment.author).toBe('Alice Smith');
    expect(comment.date).toBe('2026-01-16T09:00:00Z');
    expect(comment.body).toBe('I can reproduce this.');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/backends/ado/mappers.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

Create `src/backends/ado/mappers.ts`:

```typescript
import TurndownService from 'turndown';
import type { WorkItem, Comment } from '../../types.js';

const turndown = new TurndownService();

export interface AdoWorkItem {
  id: number;
  fields: Record<string, unknown>;
  relations?: AdoRelation[];
}

export interface AdoRelation {
  rel: string;
  url: string;
  attributes: Record<string, unknown>;
}

export interface AdoComment {
  createdBy: { displayName: string };
  createdDate: string;
  text: string;
}

export interface AdoIteration {
  name: string;
  path: string;
  attributes: {
    startDate?: string;
    finishDate?: string;
  };
}

export interface AdoWorkItemType {
  name: string;
  states: { name: string }[];
}

export function mapPriorityToTic(
  priority: number | undefined,
): 'critical' | 'high' | 'medium' | 'low' {
  switch (priority) {
    case 1:
      return 'critical';
    case 2:
      return 'high';
    case 3:
      return 'medium';
    case 4:
      return 'low';
    default:
      return 'medium';
  }
}

export function mapPriorityToAdo(priority: string): number {
  switch (priority) {
    case 'critical':
      return 1;
    case 'high':
      return 2;
    case 'medium':
      return 3;
    case 'low':
      return 4;
    default:
      return 3;
  }
}

export function parseTags(tags: string | undefined): string[] {
  if (!tags) return [];
  return tags
    .split(';')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

export function formatTags(tags: string[]): string {
  return tags.join('; ');
}

function extractIdFromUrl(url: string): string {
  const match = url.match(/\/workItems\/(\d+)$/);
  return match ? match[1]! : '';
}

export function extractParent(
  relations: AdoRelation[] | undefined,
): string | null {
  if (!relations) return null;
  const parent = relations.find(
    (r) => r.rel === 'System.LinkTypes.Hierarchy-Reverse',
  );
  return parent ? extractIdFromUrl(parent.url) : null;
}

export function extractPredecessors(
  relations: AdoRelation[] | undefined,
): string[] {
  if (!relations) return [];
  return relations
    .filter((r) => r.rel === 'System.LinkTypes.Dependency-Reverse')
    .map((r) => extractIdFromUrl(r.url))
    .filter((id) => id !== '');
}

function htmlToMarkdown(html: string | undefined): string {
  if (!html) return '';
  return turndown.turndown(html);
}

export function mapWorkItemToWorkItem(ado: AdoWorkItem): WorkItem {
  const fields = ado.fields;
  const assignedTo = fields['System.AssignedTo'] as
    | { displayName: string }
    | undefined;

  return {
    id: String(ado.id),
    title: (fields['System.Title'] as string) ?? '',
    type: (fields['System.WorkItemType'] as string) ?? '',
    status: (fields['System.State'] as string) ?? '',
    iteration: (fields['System.IterationPath'] as string) ?? '',
    priority: mapPriorityToTic(
      fields['Microsoft.VSTS.Common.Priority'] as number | undefined,
    ),
    assignee: assignedTo?.displayName ?? '',
    labels: parseTags(fields['System.Tags'] as string | undefined),
    description: htmlToMarkdown(fields['System.Description'] as string | undefined),
    created: (fields['System.CreatedDate'] as string) ?? '',
    updated: (fields['System.ChangedDate'] as string) ?? '',
    parent: extractParent(ado.relations),
    dependsOn: extractPredecessors(ado.relations),
    comments: [],
  };
}

export function mapCommentToComment(ado: AdoComment): Comment {
  return {
    author: ado.createdBy.displayName,
    date: ado.createdDate,
    body: htmlToMarkdown(ado.text),
  };
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/backends/ado/mappers.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/backends/ado/mappers.ts src/backends/ado/mappers.test.ts
git commit -m "feat(ado): add data mappers for work items, comments, and fields"
```

---

### Task 5: Backend class (`index.ts`)

**Files:**
- Create: `src/backends/ado/index.ts`
- Create: `src/backends/ado/ado.test.ts`

This is the largest task. The test file and implementation are both substantial, so this task is split into sub-steps.

**Step 1: Write the test file**

Create `src/backends/ado/ado.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AzureDevOpsBackend } from './index.js';

vi.mock('./az.js', () => ({
  az: vi.fn(),
  azExec: vi.fn(),
  azInvoke: vi.fn(),
}));

vi.mock('./remote.js', () => ({
  parseAdoRemote: vi.fn().mockReturnValue({
    org: 'contoso',
    project: 'WebApp',
  }),
}));

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
  execSync: vi.fn(),
}));

import { az, azExec, azInvoke } from './az.js';
import { execFileSync } from 'node:child_process';

const mockAz = vi.mocked(az);
const mockAzExec = vi.mocked(azExec);
const mockAzInvoke = vi.mocked(azInvoke);
const mockExecFileSync = vi.mocked(execFileSync);

function makeBackend(): AzureDevOpsBackend {
  return new AzureDevOpsBackend('/repo');
}

const sampleWorkItem = {
  id: 42,
  fields: {
    'System.Title': 'Fix login bug',
    'System.WorkItemType': 'User Story',
    'System.State': 'Active',
    'System.IterationPath': 'WebApp\\Sprint 1',
    'Microsoft.VSTS.Common.Priority': 2,
    'System.AssignedTo': { displayName: 'Alice', uniqueName: 'alice@contoso.com' },
    'System.Tags': 'bug; frontend',
    'System.Description': '<p>Login breaks.</p>',
    'System.CreatedDate': '2026-01-15T10:00:00Z',
    'System.ChangedDate': '2026-01-20T14:30:00Z',
  },
  relations: [
    {
      rel: 'System.LinkTypes.Hierarchy-Reverse',
      url: 'https://dev.azure.com/contoso/_apis/wit/workItems/10',
      attributes: {},
    },
  ],
};

const sampleComment = {
  createdBy: { displayName: 'Bob' },
  createdDate: '2026-01-16T09:00:00Z',
  text: '<p>Reproduced.</p>',
};

describe('AzureDevOpsBackend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Constructor calls azExec for auth check
    mockAzExec.mockReturnValue('');
    // Constructor calls az for work item types
    mockAz.mockReturnValue([
      { name: 'Epic', states: [{ name: 'New' }, { name: 'Active' }, { name: 'Closed' }] },
      { name: 'User Story', states: [{ name: 'New' }, { name: 'Active' }, { name: 'Resolved' }, { name: 'Closed' }] },
      { name: 'Task', states: [{ name: 'New' }, { name: 'Active' }, { name: 'Closed' }] },
    ]);
  });

  describe('constructor', () => {
    it('verifies az auth on construction', () => {
      makeBackend();
      expect(mockAzExec).toHaveBeenCalledWith(
        ['account', 'show'],
        '/repo',
      );
    });

    it('throws when az auth fails', () => {
      mockAzExec.mockImplementation(() => {
        throw new Error('Please run az login');
      });
      expect(() => makeBackend()).toThrow();
    });
  });

  describe('getCapabilities', () => {
    it('returns ADO-specific capabilities', () => {
      const backend = makeBackend();
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
  });

  describe('getStatuses', () => {
    it('returns the union of all states across types', () => {
      const backend = makeBackend();
      const statuses = backend.getStatuses();
      expect(statuses).toContain('New');
      expect(statuses).toContain('Active');
      expect(statuses).toContain('Resolved');
      expect(statuses).toContain('Closed');
      // No duplicates
      expect(new Set(statuses).size).toBe(statuses.length);
    });
  });

  describe('getWorkItemTypes', () => {
    it('returns types from ADO project', () => {
      const backend = makeBackend();
      expect(backend.getWorkItemTypes()).toEqual(['Epic', 'User Story', 'Task']);
    });
  });

  describe('getIterations', () => {
    it('returns iteration paths', () => {
      const backend = makeBackend();
      mockAz.mockReturnValueOnce([
        { name: 'Sprint 1', path: 'WebApp\\Sprint 1', attributes: { startDate: '2026-01-01', finishDate: '2026-01-14' } },
        { name: 'Sprint 2', path: 'WebApp\\Sprint 2', attributes: { startDate: '2026-01-15', finishDate: '2026-01-28' } },
      ]);
      expect(backend.getIterations()).toEqual([
        'WebApp\\Sprint 1',
        'WebApp\\Sprint 2',
      ]);
    });
  });

  describe('getCurrentIteration', () => {
    it('returns the current iteration path', () => {
      const backend = makeBackend();
      mockAz.mockReturnValueOnce([
        { name: 'Sprint 1', path: 'WebApp\\Sprint 1', attributes: { startDate: '2026-01-01T00:00:00Z', finishDate: '2030-12-31T00:00:00Z' } },
      ]);
      expect(backend.getCurrentIteration()).toBe('WebApp\\Sprint 1');
    });

    it('returns empty string when no current iteration', () => {
      const backend = makeBackend();
      mockAz.mockReturnValueOnce([]);
      expect(backend.getCurrentIteration()).toBe('');
    });
  });

  describe('setCurrentIteration', () => {
    it('is a no-op', () => {
      const backend = makeBackend();
      expect(() => backend.setCurrentIteration('Sprint 1')).not.toThrow();
    });
  });

  describe('listWorkItems', () => {
    it('uses WIQL query and batch fetch', () => {
      const backend = makeBackend();

      // WIQL query returns IDs
      mockAz.mockReturnValueOnce({
        workItems: [{ id: 42 }, { id: 43 }],
      });

      // Batch fetch returns full items
      mockAzInvoke.mockReturnValueOnce({
        value: [
          { ...sampleWorkItem, id: 42 },
          { ...sampleWorkItem, id: 43, fields: { ...sampleWorkItem.fields, 'System.ChangedDate': '2026-01-19T00:00:00Z' } },
        ],
      });

      const items = backend.listWorkItems();
      expect(items).toHaveLength(2);
      // Sorted by updated descending
      expect(items[0]!.id).toBe('42');
      expect(items[1]!.id).toBe('43');
    });

    it('filters by iteration via WIQL', () => {
      const backend = makeBackend();

      mockAz.mockReturnValueOnce({ workItems: [{ id: 42 }] });
      mockAzInvoke.mockReturnValueOnce({
        value: [sampleWorkItem],
      });

      backend.listWorkItems('WebApp\\Sprint 1');

      expect(mockAz).toHaveBeenCalledWith(
        expect.arrayContaining(['boards', 'query', '--wiql']),
        '/repo',
      );
      // Verify WIQL contains iteration filter
      const wiqlCall = mockAz.mock.calls.find((c) =>
        c[0].includes('--wiql'),
      );
      const wiqlArg = wiqlCall?.[0][wiqlCall[0].indexOf('--wiql') + 1];
      expect(wiqlArg).toContain('System.IterationPath');
    });

    it('returns empty array when no items match', () => {
      const backend = makeBackend();
      mockAz.mockReturnValueOnce({ workItems: [] });
      expect(backend.listWorkItems()).toEqual([]);
    });
  });

  describe('getWorkItem', () => {
    it('returns a work item with comments', () => {
      const backend = makeBackend();

      mockAz.mockReturnValueOnce(sampleWorkItem);
      mockAzInvoke.mockReturnValueOnce({
        comments: [sampleComment],
      });

      const item = backend.getWorkItem('42');
      expect(item.id).toBe('42');
      expect(item.title).toBe('Fix login bug');
      expect(item.comments).toHaveLength(1);
      expect(item.comments[0]!.author).toBe('Bob');
    });
  });

  describe('createWorkItem', () => {
    it('creates a work item and returns it', () => {
      const backend = makeBackend();

      mockAz.mockReturnValueOnce({ ...sampleWorkItem, id: 99 });
      // getWorkItem refetch
      mockAz.mockReturnValueOnce({ ...sampleWorkItem, id: 99 });
      mockAzInvoke.mockReturnValueOnce({ comments: [] });

      const item = backend.createWorkItem({
        title: 'New item',
        type: 'User Story',
        status: 'New',
        iteration: 'WebApp\\Sprint 1',
        priority: 'high',
        assignee: 'Alice',
        labels: ['bug'],
        description: 'Description',
        parent: null,
        dependsOn: [],
      });

      expect(item.id).toBe('99');
      expect(mockAz).toHaveBeenCalledWith(
        expect.arrayContaining([
          'boards',
          'work-item',
          'create',
          '--type',
          'User Story',
          '--title',
          'New item',
        ]),
        '/repo',
      );
    });
  });

  describe('updateWorkItem', () => {
    it('updates work item fields', () => {
      const backend = makeBackend();

      mockAz.mockReturnValueOnce(sampleWorkItem);
      // getWorkItem refetch
      mockAz.mockReturnValueOnce({ ...sampleWorkItem, fields: { ...sampleWorkItem.fields, 'System.Title': 'Updated' } });
      mockAzInvoke.mockReturnValueOnce({ comments: [] });

      const item = backend.updateWorkItem('42', { title: 'Updated' });

      expect(mockAz).toHaveBeenCalledWith(
        expect.arrayContaining([
          'boards',
          'work-item',
          'update',
          '--id',
          '42',
        ]),
        '/repo',
      );
    });
  });

  describe('deleteWorkItem', () => {
    it('deletes a work item', () => {
      const backend = makeBackend();
      mockAzExec.mockReturnValue('');

      backend.deleteWorkItem('42');

      expect(mockAzExec).toHaveBeenCalledWith(
        expect.arrayContaining([
          'boards',
          'work-item',
          'delete',
          '--id',
          '42',
          '--yes',
        ]),
        '/repo',
      );
    });
  });

  describe('addComment', () => {
    it('adds a comment and returns it', () => {
      const backend = makeBackend();
      mockAzInvoke.mockReturnValueOnce(sampleComment);

      const comment = backend.addComment('42', {
        author: 'Alice',
        body: 'A comment.',
      });

      expect(comment.author).toBe('Alice');
      expect(comment.body).toBe('A comment.');
    });
  });

  describe('getChildren', () => {
    it('returns child work items via WIQL', () => {
      const backend = makeBackend();

      mockAz.mockReturnValueOnce({
        workItems: [{ id: 50 }, { id: 51 }],
      });
      mockAzInvoke.mockReturnValueOnce({
        value: [
          { ...sampleWorkItem, id: 50 },
          { ...sampleWorkItem, id: 51 },
        ],
      });

      const children = backend.getChildren('42');
      expect(children).toHaveLength(2);
    });

    it('returns empty array when no children', () => {
      const backend = makeBackend();
      mockAz.mockReturnValueOnce({ workItems: [] });
      expect(backend.getChildren('42')).toEqual([]);
    });
  });

  describe('getDependents', () => {
    it('returns dependent work items via WIQL', () => {
      const backend = makeBackend();

      mockAz.mockReturnValueOnce({
        workItems: [{ id: 60 }],
      });
      mockAzInvoke.mockReturnValueOnce({
        value: [{ ...sampleWorkItem, id: 60 }],
      });

      const dependents = backend.getDependents('42');
      expect(dependents).toHaveLength(1);
    });
  });

  describe('getItemUrl', () => {
    it('returns the ADO web URL for a work item', () => {
      const backend = makeBackend();
      const url = backend.getItemUrl('42');
      expect(url).toBe(
        'https://dev.azure.com/contoso/WebApp/_workitems/edit/42',
      );
    });
  });

  describe('openItem', () => {
    it('opens the work item URL in the browser', () => {
      const backend = makeBackend();
      mockExecFileSync.mockReturnValue('');

      backend.openItem('42');

      expect(mockExecFileSync).toHaveBeenCalledWith('open', [
        'https://dev.azure.com/contoso/WebApp/_workitems/edit/42',
      ]);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/backends/ado/ado.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

Create `src/backends/ado/index.ts`:

```typescript
import { execFileSync } from 'node:child_process';
import { BaseBackend } from '../types.js';
import type { BackendCapabilities } from '../types.js';
import type {
  WorkItem,
  NewWorkItem,
  NewComment,
  Comment,
} from '../../types.js';
import { az, azExec, azInvoke } from './az.js';
import { parseAdoRemote } from './remote.js';
import {
  mapWorkItemToWorkItem,
  mapCommentToComment,
  mapPriorityToAdo,
  formatTags,
} from './mappers.js';
import type { AdoWorkItem, AdoComment, AdoWorkItemType } from './mappers.js';

const BATCH_FIELDS = [
  'System.Id',
  'System.Title',
  'System.WorkItemType',
  'System.State',
  'System.IterationPath',
  'Microsoft.VSTS.Common.Priority',
  'System.AssignedTo',
  'System.Tags',
  'System.Description',
  'System.CreatedDate',
  'System.ChangedDate',
];

export class AzureDevOpsBackend extends BaseBackend {
  private cwd: string;
  private org: string;
  private project: string;
  private types: AdoWorkItemType[];

  constructor(cwd: string) {
    super();
    this.cwd = cwd;
    azExec(['account', 'show'], cwd);
    const remote = parseAdoRemote(cwd);
    this.org = remote.org;
    this.project = remote.project;
    this.types = az<AdoWorkItemType[]>(
      [
        'boards',
        'work-item',
        'type',
        'list',
        '--org',
        `https://dev.azure.com/${this.org}`,
        '--project',
        this.project,
      ],
      cwd,
    );
  }

  getCapabilities(): BackendCapabilities {
    return {
      relationships: true,
      customTypes: false,
      customStatuses: false,
      iterations: true,
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

  getStatuses(): string[] {
    const allStates = new Set<string>();
    for (const type of this.types) {
      for (const state of type.states) {
        allStates.add(state.name);
      }
    }
    return [...allStates];
  }

  getWorkItemTypes(): string[] {
    return this.types.map((t) => t.name);
  }

  getIterations(): string[] {
    const iterations = az<{ path: string }[]>(
      [
        'boards',
        'iteration',
        'team',
        'list',
        '--team',
        `${this.project} Team`,
        '--org',
        `https://dev.azure.com/${this.org}`,
        '--project',
        this.project,
      ],
      this.cwd,
    );
    return iterations.map((i) => i.path);
  }

  getCurrentIteration(): string {
    const iterations = az<{ path: string }[]>(
      [
        'boards',
        'iteration',
        'team',
        'list',
        '--team',
        `${this.project} Team`,
        '--timeframe',
        'current',
        '--org',
        `https://dev.azure.com/${this.org}`,
        '--project',
        this.project,
      ],
      this.cwd,
    );
    return iterations[0]?.path ?? '';
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  setCurrentIteration(_name: string): void {
    // No-op — current iteration is determined by date range in ADO
  }

  listWorkItems(iteration?: string): WorkItem[] {
    let wiql = `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${this.project}'`;
    if (iteration) {
      wiql += ` AND [System.IterationPath] = '${iteration}'`;
    }

    const queryResult = az<{ workItems: { id: number }[] }>(
      [
        'boards',
        'query',
        '--wiql',
        wiql,
        '--org',
        `https://dev.azure.com/${this.org}`,
        '--project',
        this.project,
      ],
      this.cwd,
    );

    const ids = queryResult.workItems.map((w) => w.id);
    if (ids.length === 0) return [];

    const batchResult = azInvoke<{ value: AdoWorkItem[] }>(
      {
        area: 'wit',
        resource: 'workitemsbatch',
        httpMethod: 'POST',
        body: { ids, fields: BATCH_FIELDS },
        apiVersion: '7.1',
      },
      this.cwd,
    );

    const items = batchResult.value.map(mapWorkItemToWorkItem);
    items.sort((a, b) => b.updated.localeCompare(a.updated));
    return items;
  }

  getWorkItem(id: string): WorkItem {
    const ado = az<AdoWorkItem>(
      [
        'boards',
        'work-item',
        'show',
        '--id',
        id,
        '--expand',
        'relations',
        '--org',
        `https://dev.azure.com/${this.org}`,
        '--project',
        this.project,
      ],
      this.cwd,
    );

    const item = mapWorkItemToWorkItem(ado);

    // Fetch comments
    const commentResult = azInvoke<{ comments: AdoComment[] }>(
      {
        area: 'wit',
        resource: 'comments',
        routeParameters: `workItemId=${id}`,
        apiVersion: '7.1',
      },
      this.cwd,
    );
    item.comments = (commentResult.comments ?? []).map(mapCommentToComment);
    return item;
  }

  createWorkItem(data: NewWorkItem): WorkItem {
    this.validateFields(data);

    const args = [
      'boards',
      'work-item',
      'create',
      '--type',
      data.type,
      '--title',
      data.title,
      '--org',
      `https://dev.azure.com/${this.org}`,
      '--project',
      this.project,
    ];

    const fields: string[] = [];
    if (data.status) fields.push(`System.State=${data.status}`);
    if (data.iteration) fields.push(`System.IterationPath=${data.iteration}`);
    if (data.priority) fields.push(`Microsoft.VSTS.Common.Priority=${mapPriorityToAdo(data.priority)}`);
    if (data.assignee) fields.push(`System.AssignedTo=${data.assignee}`);
    if (data.labels.length > 0) fields.push(`System.Tags=${formatTags(data.labels)}`);
    if (data.description) fields.push(`System.Description=${data.description}`);

    for (const field of fields) {
      args.push('--fields', field);
    }

    const created = az<AdoWorkItem>(args, this.cwd);
    const createdId = String(created.id);

    // Add parent relation if specified
    if (data.parent) {
      azExec(
        [
          'boards',
          'work-item',
          'relation',
          'add',
          '--id',
          createdId,
          '--relation-type',
          'System.LinkTypes.Hierarchy-Reverse',
          '--target-id',
          data.parent,
          '--org',
          `https://dev.azure.com/${this.org}`,
        ],
        this.cwd,
      );
    }

    // Add dependency relations
    for (const depId of data.dependsOn) {
      azExec(
        [
          'boards',
          'work-item',
          'relation',
          'add',
          '--id',
          createdId,
          '--relation-type',
          'System.LinkTypes.Dependency-Reverse',
          '--target-id',
          depId,
          '--org',
          `https://dev.azure.com/${this.org}`,
        ],
        this.cwd,
      );
    }

    return this.getWorkItem(createdId);
  }

  updateWorkItem(id: string, data: Partial<WorkItem>): WorkItem {
    this.validateFields(data);

    const args = [
      'boards',
      'work-item',
      'update',
      '--id',
      id,
      '--org',
      `https://dev.azure.com/${this.org}`,
      '--project',
      this.project,
    ];

    const fields: string[] = [];
    if (data.title !== undefined) fields.push(`System.Title=${data.title}`);
    if (data.status !== undefined) fields.push(`System.State=${data.status}`);
    if (data.iteration !== undefined) fields.push(`System.IterationPath=${data.iteration}`);
    if (data.priority !== undefined) fields.push(`Microsoft.VSTS.Common.Priority=${mapPriorityToAdo(data.priority)}`);
    if (data.assignee !== undefined) fields.push(`System.AssignedTo=${data.assignee}`);
    if (data.labels !== undefined) fields.push(`System.Tags=${formatTags(data.labels)}`);
    if (data.description !== undefined) fields.push(`System.Description=${data.description}`);

    for (const field of fields) {
      args.push('--fields', field);
    }

    if (fields.length > 0) {
      az(args, this.cwd);
    }

    return this.getWorkItem(id);
  }

  deleteWorkItem(id: string): void {
    azExec(
      [
        'boards',
        'work-item',
        'delete',
        '--id',
        id,
        '--yes',
        '--org',
        `https://dev.azure.com/${this.org}`,
        '--project',
        this.project,
      ],
      this.cwd,
    );
  }

  addComment(workItemId: string, comment: NewComment): Comment {
    azInvoke(
      {
        area: 'wit',
        resource: 'comments',
        routeParameters: `workItemId=${workItemId}`,
        httpMethod: 'POST',
        body: { text: comment.body },
        apiVersion: '7.1',
      },
      this.cwd,
    );

    return {
      author: comment.author,
      date: new Date().toISOString(),
      body: comment.body,
    };
  }

  getChildren(id: string): WorkItem[] {
    const wiql = `SELECT [System.Id] FROM WorkItemLinks WHERE [Source].[System.Id] = ${id} AND [System.Links.LinkType] = 'System.LinkTypes.Hierarchy-Forward' MODE (MustContain)`;

    const queryResult = az<{ workItems?: { id: number }[]; workItemRelations?: { target: { id: number } }[] }>(
      [
        'boards',
        'query',
        '--wiql',
        wiql,
        '--org',
        `https://dev.azure.com/${this.org}`,
        '--project',
        this.project,
      ],
      this.cwd,
    );

    const ids = queryResult.workItems?.map((w) => w.id) ?? [];
    if (ids.length === 0) return [];

    const batchResult = azInvoke<{ value: AdoWorkItem[] }>(
      {
        area: 'wit',
        resource: 'workitemsbatch',
        httpMethod: 'POST',
        body: { ids, fields: BATCH_FIELDS },
        apiVersion: '7.1',
      },
      this.cwd,
    );

    return batchResult.value.map(mapWorkItemToWorkItem);
  }

  getDependents(id: string): WorkItem[] {
    const wiql = `SELECT [System.Id] FROM WorkItemLinks WHERE [Source].[System.Id] = ${id} AND [System.Links.LinkType] = 'System.LinkTypes.Dependency-Forward' MODE (MustContain)`;

    const queryResult = az<{ workItems?: { id: number }[]; workItemRelations?: { target: { id: number } }[] }>(
      [
        'boards',
        'query',
        '--wiql',
        wiql,
        '--org',
        `https://dev.azure.com/${this.org}`,
        '--project',
        this.project,
      ],
      this.cwd,
    );

    const ids = queryResult.workItems?.map((w) => w.id) ?? [];
    if (ids.length === 0) return [];

    const batchResult = azInvoke<{ value: AdoWorkItem[] }>(
      {
        area: 'wit',
        resource: 'workitemsbatch',
        httpMethod: 'POST',
        body: { ids, fields: BATCH_FIELDS },
        apiVersion: '7.1',
      },
      this.cwd,
    );

    return batchResult.value.map(mapWorkItemToWorkItem);
  }

  getItemUrl(id: string): string {
    return `https://dev.azure.com/${this.org}/${encodeURIComponent(this.project)}/_workitems/edit/${id}`;
  }

  openItem(id: string): void {
    const url = this.getItemUrl(id);
    execFileSync('open', [url]);
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/backends/ado/ado.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/backends/ado/index.ts src/backends/ado/ado.test.ts
git commit -m "feat(ado): implement AzureDevOpsBackend with full Backend interface"
```

---

### Task 6: Wire up factory

**Files:**
- Modify: `src/backends/factory.ts:1-47`
- Modify: `src/backends/factory.test.ts:52-55`

**Step 1: Update the factory test**

In `src/backends/factory.test.ts`, change the test on line 52-55 from expecting "not yet implemented" to expecting it to attempt creating the backend (like GitHub/GitLab tests):

Replace:
```typescript
  it('throws for unimplemented backends', () => {
    writeConfig(tmpDir, { ...defaultConfig, backend: 'azure' });
    expect(() => createBackend(tmpDir)).toThrow('not yet implemented');
  });
```

With:
```typescript
  it('attempts to create AzureDevOpsBackend when backend is azure', () => {
    writeConfig(tmpDir, { ...defaultConfig, backend: 'azure' });
    // Throws because az auth will fail in test env, but NOT "not yet implemented"
    expect(() => createBackend(tmpDir)).not.toThrow('not yet implemented');
  });
```

**Step 2: Run the factory test to verify it fails**

Run: `npx vitest run src/backends/factory.test.ts`
Expected: FAIL — test expects no "not yet implemented" but factory still throws it

**Step 3: Update the factory**

In `src/backends/factory.ts`, add the import and replace the `azure` case:

Add import at top (after line 5):
```typescript
import { AzureDevOpsBackend } from './ado/index.js';
```

Replace the `azure` case (lines 38-41):
```typescript
    case 'azure':
      return new AzureDevOpsBackend(root);
```

Also update `detectBackend` to detect SSH and legacy formats too. Replace line 20:
```typescript
    if (
      output.includes('dev.azure.com') ||
      output.includes('ssh.dev.azure.com') ||
      /\w+\.visualstudio\.com/.test(output)
    )
      return 'azure';
```

**Step 4: Run the factory test to verify it passes**

Run: `npx vitest run src/backends/factory.test.ts`
Expected: All tests PASS

**Step 5: Run all tests**

Run: `npm test`
Expected: All tests PASS (240 existing + new ADO tests)

**Step 6: Commit**

```bash
git add src/backends/factory.ts src/backends/factory.test.ts
git commit -m "feat(ado): wire up AzureDevOpsBackend in factory"
```

---

### Task 7: Run full validation

**Step 1: Run format check**

Run: `npm run format:check`
Expected: All files pass. If not, run `npm run format` and commit.

**Step 2: Run linter**

Run: `npm run lint`
Expected: No errors. If errors, fix and commit.

**Step 3: Run type check**

Run: `npx tsc --noEmit`
Expected: No type errors. If errors, fix and commit.

**Step 4: Run all tests**

Run: `npm test`
Expected: All tests PASS

**Step 5: Commit any fixes**

If any fixes were needed, commit them:
```bash
git add -A
git commit -m "fix(ado): address lint/format/type issues"
```
