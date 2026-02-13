# Jira API Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the `acli` CLI dependency in the Jira backend with direct REST API v3 calls, adding keychain-based API Token auth to the TUI and CLI.

**Architecture:** `JiraApiClient extends BaseApiClient` with Basic auth (`email:token`). The backend keeps its current `BaseBackend` structure but replaces every `acli`/`acliExec` call with `api.rest()`. Auth credentials stored in keychain as `"jira:{site}"` → `"email:token"`.

**Tech Stack:** TypeScript, Jira REST API v3, `@napi-rs/keyring`, `BaseApiClient` from `src/backends/shared/api-client.ts`

---

### Task 1: Jira Auth — Keychain Credential Management

**Files:**
- Create: `src/auth/jira.ts`
- Test: `src/auth/jira.test.ts`

**Step 1: Write the failing tests**

Create `src/auth/jira.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./keychain.js', () => ({
  getToken: vi.fn(),
  setToken: vi.fn(),
  deleteToken: vi.fn(),
}));

import { getToken, setToken, deleteToken } from './keychain.js';
import {
  getJiraCredentials,
  setJiraCredentials,
  removeJiraCredentials,
  JIRA_ACCOUNT_PREFIX,
} from './jira.js';

const mockGetToken = vi.mocked(getToken);
const mockSetToken = vi.mocked(setToken);
const mockDeleteToken = vi.mocked(deleteToken);

describe('Jira auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getJiraCredentials', () => {
    it('returns email and token when stored', () => {
      mockGetToken.mockReturnValue('user@corp.com:ABCdef123');
      const creds = getJiraCredentials('mycompany.atlassian.net');
      expect(mockGetToken).toHaveBeenCalledWith('jira:mycompany.atlassian.net');
      expect(creds).toEqual({ email: 'user@corp.com', token: 'ABCdef123' });
    });

    it('returns null when no credentials stored', () => {
      mockGetToken.mockReturnValue(null);
      expect(getJiraCredentials('mycompany.atlassian.net')).toBeNull();
    });

    it('handles tokens containing colons', () => {
      mockGetToken.mockReturnValue('user@corp.com:ABC:def:123');
      const creds = getJiraCredentials('mycompany.atlassian.net');
      expect(creds).toEqual({ email: 'user@corp.com', token: 'ABC:def:123' });
    });
  });

  describe('setJiraCredentials', () => {
    it('stores email:token in keychain', () => {
      setJiraCredentials('mycompany.atlassian.net', 'user@corp.com', 'token123');
      expect(mockSetToken).toHaveBeenCalledWith(
        'jira:mycompany.atlassian.net',
        'user@corp.com:token123',
      );
    });
  });

  describe('removeJiraCredentials', () => {
    it('deletes from keychain', () => {
      removeJiraCredentials('mycompany.atlassian.net');
      expect(mockDeleteToken).toHaveBeenCalledWith(
        'jira:mycompany.atlassian.net',
      );
    });
  });

  describe('JIRA_ACCOUNT_PREFIX', () => {
    it('equals "jira:"', () => {
      expect(JIRA_ACCOUNT_PREFIX).toBe('jira:');
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/auth/jira.test.ts`
Expected: FAIL — `src/auth/jira.ts` does not exist yet.

**Step 3: Write the implementation**

Create `src/auth/jira.ts`:

```typescript
import { getToken, setToken, deleteToken } from './keychain.js';

export const JIRA_ACCOUNT_PREFIX = 'jira:';

export interface JiraCredentials {
  email: string;
  token: string;
}

/**
 * Retrieve stored Jira credentials from the system keychain.
 * Returns null if no credentials are found for the given site.
 */
export function getJiraCredentials(site: string): JiraCredentials | null {
  const stored = getToken(`${JIRA_ACCOUNT_PREFIX}${site}`);
  if (!stored) return null;

  const idx = stored.indexOf(':');
  if (idx < 0) return null;

  return {
    email: stored.slice(0, idx),
    token: stored.slice(idx + 1),
  };
}

/**
 * Store Jira credentials in the system keychain.
 */
export function setJiraCredentials(
  site: string,
  email: string,
  token: string,
): void {
  setToken(`${JIRA_ACCOUNT_PREFIX}${site}`, `${email}:${token}`);
}

/**
 * Remove Jira credentials from the system keychain.
 */
export function removeJiraCredentials(site: string): void {
  deleteToken(`${JIRA_ACCOUNT_PREFIX}${site}`);
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/auth/jira.test.ts`
Expected: PASS — all 6 tests pass.

**Step 5: Commit**

```bash
git add src/auth/jira.ts src/auth/jira.test.ts
git commit -m "feat(jira): add keychain credential management for Jira API tokens"
```

---

### Task 2: Jira API Client

**Files:**
- Create: `src/backends/jira/api.ts`
- Test: `src/backends/jira/api.test.ts`

**Step 1: Write the failing tests**

Create `src/backends/jira/api.test.ts`. Follow the same `mockResponse` + `globalThis.fetch` pattern used in `src/backends/github/api.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JiraApiClient } from './api.js';
import { AuthError } from '../shared/api-client.js';

function mockResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  const headersObj = new Headers(headers);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: headersObj,
    json: vi.fn().mockResolvedValue(body),
    text: vi
      .fn()
      .mockResolvedValue(
        typeof body === 'string' ? body : JSON.stringify(body),
      ),
  } as unknown as Response;
}

describe('JiraApiClient', () => {
  let client: JiraApiClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    client = new JiraApiClient('user@corp.com', 'api-token-123', 'mycompany.atlassian.net');
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof globalThis.fetch;
  });

  describe('rest', () => {
    it('sends Basic auth header with base64-encoded email:token', async () => {
      const data = { id: '1' };
      fetchMock.mockResolvedValue(mockResponse(200, data));

      const result = await client.rest<typeof data>('GET', '/api/3/myself');

      const expectedAuth = `Basic ${Buffer.from('user@corp.com:api-token-123').toString('base64')}`;
      expect(fetchMock).toHaveBeenCalledWith(
        'https://mycompany.atlassian.net/rest/api/3/myself',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: expectedAuth,
            Accept: 'application/json',
          }),
        }),
      );
      expect(result).toEqual(data);
    });

    it('sends JSON body on POST', async () => {
      const body = { fields: { summary: 'Test' } };
      fetchMock.mockResolvedValue(mockResponse(201, { key: 'TEAM-1' }));

      await client.rest('POST', '/api/3/issue', body);

      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(body),
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        }),
      );
    });

    it('throws AuthError on 401', async () => {
      fetchMock.mockResolvedValue(mockResponse(401, 'Unauthorized'));
      await expect(client.rest('GET', '/api/3/myself')).rejects.toThrow(
        AuthError,
      );
    });

    it('throws on non-ok response with error body', async () => {
      fetchMock.mockResolvedValue(
        mockResponse(400, {
          errorMessages: ['Field "summary" is required'],
          errors: {},
        }),
      );
      await expect(client.rest('POST', '/api/3/issue', {})).rejects.toThrow(
        'summary',
      );
    });

    it('retries on 5xx errors', async () => {
      fetchMock
        .mockResolvedValueOnce(mockResponse(500, 'Internal Server Error'))
        .mockResolvedValueOnce(mockResponse(200, { ok: true }));

      const result = await client.rest<{ ok: boolean }>('GET', '/api/3/myself');
      expect(result).toEqual({ ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('respects Retry-After on 429', async () => {
      fetchMock.mockResolvedValue(
        mockResponse(429, 'Rate limited', { 'Retry-After': '5' }),
      );
      await expect(client.rest('GET', '/api/3/myself')).rejects.toThrow(
        'HTTP 429',
      );
    });
  });

  describe('paginate', () => {
    it('fetches all pages using startAt + total', async () => {
      fetchMock
        .mockResolvedValueOnce(
          mockResponse(200, {
            startAt: 0,
            maxResults: 2,
            total: 3,
            issues: [{ key: 'TEAM-1' }, { key: 'TEAM-2' }],
          }),
        )
        .mockResolvedValueOnce(
          mockResponse(200, {
            startAt: 2,
            maxResults: 2,
            total: 3,
            issues: [{ key: 'TEAM-3' }],
          }),
        );

      const results: unknown[] = [];
      for await (const page of client.paginate('/api/3/search?jql=project=TEAM')) {
        results.push(...page);
      }
      expect(results).toEqual([
        { key: 'TEAM-1' },
        { key: 'TEAM-2' },
        { key: 'TEAM-3' },
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('handles empty results', async () => {
      fetchMock.mockResolvedValueOnce(
        mockResponse(200, {
          startAt: 0,
          maxResults: 50,
          total: 0,
          issues: [],
        }),
      );

      const results: unknown[] = [];
      for await (const page of client.paginate('/api/3/search?jql=project=TEAM')) {
        results.push(...page);
      }
      expect(results).toEqual([]);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/backends/jira/api.test.ts`
Expected: FAIL — `src/backends/jira/api.ts` does not exist yet.

**Step 3: Write the implementation**

Create `src/backends/jira/api.ts`:

```typescript
import { AuthError, BaseApiClient } from '../shared/api-client.js';

interface JiraSearchResponse<T> {
  startAt: number;
  maxResults: number;
  total: number;
  issues: T[];
}

interface JiraErrorResponse {
  errorMessages?: string[];
  errors?: Record<string, string>;
}

export class JiraApiClient extends BaseApiClient {
  private email: string;

  constructor(email: string, token: string, site: string) {
    super(token, `https://${site}/rest`);
    this.email = email;
  }

  private getAuthHeader(): string {
    return `Basic ${Buffer.from(`${this.email}:${this.token}`).toString('base64')}`;
  }

  protected override async fetch<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = this.baseUrl + path;

    const headers: Record<string, string> = {
      Authorization: this.getAuthHeader(),
      Accept: 'application/json',
    };

    const init: RequestInit = { method, headers };

    if (body !== undefined && ['POST', 'PATCH', 'PUT'].includes(method)) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    const response = await globalThis.fetch(url, init);

    if (response.status === 401) {
      throw new AuthError();
    }

    if (!response.ok) {
      const text = await response.text();

      // Try to parse Jira error format for readable messages
      try {
        const errorBody = JSON.parse(text) as JiraErrorResponse;
        const messages: string[] = [];
        if (errorBody.errorMessages?.length) {
          messages.push(...errorBody.errorMessages);
        }
        if (errorBody.errors) {
          for (const [field, msg] of Object.entries(errorBody.errors)) {
            messages.push(`${field}: ${msg}`);
          }
        }
        if (messages.length > 0) {
          throw new Error(`Jira API error: ${messages.join('; ')}`);
        }
      } catch (e) {
        if (e instanceof Error && e.message.startsWith('Jira API error:')) {
          throw e;
        }
      }

      throw new Error(`HTTP ${response.status}: ${text}`);
    }

    return (await response.json()) as T;
  }

  async rest<T>(method: string, path: string, body?: unknown): Promise<T> {
    return this.retry(() => this.fetch<T>(method, path, body));
  }

  async *paginate<T>(path: string): AsyncGenerator<T[]> {
    let startAt = 0;
    const separator = path.includes('?') ? '&' : '?';

    while (true) {
      const url = `${path}${separator}startAt=${startAt}&maxResults=50`;
      const response = await this.rest<JiraSearchResponse<T>>('GET', url);

      if (response.issues.length > 0) {
        yield response.issues;
      }

      startAt += response.issues.length;

      if (startAt >= response.total || response.issues.length === 0) {
        break;
      }
    }
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/backends/jira/api.test.ts`
Expected: PASS — all tests pass.

**Step 5: Commit**

```bash
git add src/backends/jira/api.ts src/backends/jira/api.test.ts
git commit -m "feat(jira): add JiraApiClient with Basic auth and offset-based pagination"
```

---

### Task 3: Rewrite JiraBackend to Use REST API

**Files:**
- Modify: `src/backends/jira/index.ts` (full rewrite)
- Modify: `src/backends/jira/mappers.ts` (minor: Jira REST v3 returns description as ADF object, not plain text)

**Step 1: Update mappers for REST API v3 response shapes**

Jira REST API v3 returns `description` as an Atlassian Document Format (ADF) object, not a plain string. The `acli` tool was converting this to plain text. We need a simple ADF-to-text converter.

Read `src/backends/jira/mappers.ts` and add an `adfToText` helper. Also update `JiraComment.body` to accept ADF:

In `src/backends/jira/mappers.ts`, add:

```typescript
// ADF → plain text (minimal conversion for display)
interface AdfNode {
  type: string;
  text?: string;
  content?: AdfNode[];
}

export function adfToText(adf: AdfNode | string | null | undefined): string {
  if (!adf) return '';
  if (typeof adf === 'string') return adf;

  const parts: string[] = [];
  if (adf.text) parts.push(adf.text);
  if (adf.content) {
    for (const child of adf.content) {
      parts.push(adfToText(child));
    }
  }
  return parts.join('');
}
```

Update `JiraIssue.fields.description` type from `string | null` to `unknown` (ADF object or null).

Update `mapIssueToWorkItem` to use `adfToText(issue.fields.description)` instead of `issue.fields.description ?? ''`.

Update `JiraComment.body` type from `string` to `unknown` and `mapCommentToComment` to use `adfToText(comment.body)`.

**Step 2: Rewrite `src/backends/jira/index.ts`**

Replace all `acli`/`acliExec`/`acliExecSync` imports with `JiraApiClient`. Change constructor pattern to `private constructor(api, config)` + `static async create(root, options?)`:

```typescript
import { BaseBackend, UnsupportedOperationError } from '../types.js';
import type { BackendCapabilities } from '../types.js';
import type {
  WorkItem,
  NewWorkItem,
  NewComment,
  Comment,
  Template,
} from '../../types.js';
import { readJiraConfig } from './config.js';
import type { JiraConfig } from './config.js';
import { JiraApiClient } from './api.js';
import {
  mapIssueToWorkItem,
  mapPriorityToJira,
  mapCommentToComment,
  adfToText,
} from './mappers.js';
import type { JiraIssue, JiraSprint } from './mappers.js';
import { getJiraCredentials } from '../../auth/jira.js';
import { AuthError } from '../shared/api-client.js';

function titleCase(s: string): string {
  return s
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// Strip protocol for keychain lookup — site in config may include "https://"
function normalizeSite(site: string): string {
  return site.replace(/^https?:\/\//, '');
}

export class JiraBackend extends BaseBackend {
  private api: JiraApiClient;
  private config: JiraConfig;

  private cachedSprints: JiraSprint[] | null = null;

  private constructor(api: JiraApiClient, config: JiraConfig) {
    super(60_000);
    this.api = api;
    this.config = config;
  }

  protected override onCacheInvalidate(): void {
    this.cachedSprints = null;
  }

  static async create(
    root: string,
    options?: { skipAuth?: boolean },
  ): Promise<JiraBackend> {
    const config = await readJiraConfig(root);
    const site = normalizeSite(config.site);
    const credentials = getJiraCredentials(site);

    if (!credentials) {
      throw new AuthError(
        `No Jira credentials found for ${site}. Run "tic auth login jira" or authenticate in the TUI.`,
      );
    }

    const api = new JiraApiClient(credentials.email, credentials.token, site);

    if (!options?.skipAuth) {
      // Validate credentials
      await api.rest('GET', '/api/3/myself');
    }

    return new JiraBackend(api, config);
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
      templates: false,
      templateFields: {
        type: false,
        status: false,
        priority: false,
        assignee: false,
        labels: false,
        iteration: false,
        parent: false,
        dependsOn: false,
        description: false,
      },
    };
  }

  async getStatuses(): Promise<string[]> {
    const statuses = await this.api.rest<{ name: string }[]>(
      'GET',
      `/api/3/project/${this.config.project}/statuses`,
    );
    // Jira returns statuses grouped by issue type — flatten and dedupe
    const allStatuses: string[] = [];
    for (const group of statuses as unknown as { statuses: { name: string }[] }[]) {
      for (const s of group.statuses) {
        const name = s.name.toLowerCase();
        if (!allStatuses.includes(name)) {
          allStatuses.push(name);
        }
      }
    }
    return allStatuses;
  }

  async getWorkItemTypes(): Promise<string[]> {
    const project = await this.api.rest<{ issueTypes: { name: string }[] }>(
      'GET',
      `/api/3/project/${this.config.project}`,
    );
    return project.issueTypes.map((t) => t.name.toLowerCase());
  }

  async getAssignees(): Promise<string[]> {
    try {
      const users = await this.api.rest<{ emailAddress: string }[]>(
        'GET',
        `/api/3/user/assignable/search?project=${this.config.project}`,
      );
      return users.map((u) => u.emailAddress);
    } catch {
      return [];
    }
  }

  async getLabels(): Promise<string[]> {
    return this.getLabelsFromCache();
  }

  async getIterations(): Promise<string[]> {
    if (!this.config.boardId) return [];
    const sprints = await this.fetchSprints();
    return sprints.map((s) => s.name);
  }

  async getCurrentIteration(): Promise<string> {
    if (!this.config.boardId) return '';
    const response = await this.api.rest<{ values: JiraSprint[] }>(
      'GET',
      `/agile/1.0/board/${this.config.boardId}/sprint?state=active`,
    );
    return response.values.length > 0 ? response.values[0]!.name : '';
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async setCurrentIteration(_name: string): Promise<void> {
    // No-op — current iteration is the active sprint
  }

  async listWorkItems(iteration?: string): Promise<WorkItem[]> {
    let jql = `project = ${this.config.project}`;

    if (iteration && this.config.boardId) {
      const sprints = await this.fetchSprints();
      const sprint = sprints.find((s) => s.name === iteration);
      if (!sprint) return [];
      jql += ` AND sprint = ${sprint.id}`;
    }

    const issues: JiraIssue[] = [];
    for await (const page of this.api.paginate<JiraIssue>(
      `/api/3/search?jql=${encodeURIComponent(jql)}&fields=*all`,
    )) {
      issues.push(...page);
    }

    let items = issues.map(mapIssueToWorkItem);
    if (iteration && !this.config.boardId) {
      items = items.filter((i) => i.iteration === iteration);
    }
    return items;
  }

  async getWorkItem(id: string): Promise<WorkItem> {
    const issue = await this.api.rest<JiraIssue>(
      'GET',
      `/api/3/issue/${id}?fields=*all`,
    );
    const item = mapIssueToWorkItem(issue);

    // Fetch comments separately
    try {
      const commentResponse = await this.api.rest<{
        comments: { author: { displayName: string; emailAddress: string }; created: string; body: unknown }[];
      }>('GET', `/api/3/issue/${id}/comment`);
      item.comments = commentResponse.comments.map((c) =>
        mapCommentToComment({
          author: c.author,
          created: c.created,
          body: c.body,
        }),
      );
    } catch {
      // Comments may fail — leave empty
    }

    return item;
  }

  async createWorkItem(data: NewWorkItem): Promise<WorkItem> {
    this.validateFields(data);

    const fields: Record<string, unknown> = {
      project: { key: this.config.project },
      issuetype: { name: titleCase(data.type) },
      summary: data.title,
    };

    if (data.description) {
      fields.description = {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: data.description }],
          },
        ],
      };
    }
    if (data.priority && data.priority !== 'medium') {
      fields.priority = { name: mapPriorityToJira(data.priority) };
    }
    if (data.assignee) {
      fields.assignee = { id: data.assignee };
    }
    if (data.labels.length > 0) {
      fields.labels = data.labels;
    }
    if (data.parent) {
      fields.parent = { key: data.parent };
    }

    const result = await this.api.rest<{ key: string }>(
      'POST',
      '/api/3/issue',
      { fields },
    );
    const key = result.key;

    // Create dependency links
    if (data.dependsOn.length > 0) {
      try {
        for (const dep of data.dependsOn) {
          await this.api.rest('POST', '/api/3/issueLink', {
            type: { name: 'Blocks' },
            inwardIssue: { key },
            outwardIssue: { key: dep },
          });
        }
      } catch (err) {
        try {
          await this.api.rest('DELETE', `/api/3/issue/${key}`);
        } catch {
          // Best-effort cleanup
        }
        this.invalidateCache();
        throw new Error(
          `Failed to create dependency links for ${key}; issue was rolled back: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    this.invalidateCache();
    return this.getWorkItem(key);
  }

  async updateWorkItem(id: string, data: Partial<WorkItem>): Promise<WorkItem> {
    this.validateFields(data);

    // Handle status transition separately — must find transition ID
    if (data.status !== undefined) {
      const transitions = await this.api.rest<{
        transitions: { id: string; name: string }[];
      }>('GET', `/api/3/issue/${id}/transitions`);

      const transition = transitions.transitions.find(
        (t) => t.name.toLowerCase() === data.status!.toLowerCase(),
      );

      if (!transition) {
        // Try title case match
        const titleCased = titleCase(data.status);
        const tcTransition = transitions.transitions.find(
          (t) => t.name === titleCased,
        );
        if (tcTransition) {
          await this.api.rest('POST', `/api/3/issue/${id}/transitions`, {
            transition: { id: tcTransition.id },
          });
        }
      } else {
        await this.api.rest('POST', `/api/3/issue/${id}/transitions`, {
          transition: { id: transition.id },
        });
      }
    }

    // Build fields update
    const fields: Record<string, unknown> = {};
    let hasFields = false;

    if (data.title !== undefined) {
      fields.summary = data.title;
      hasFields = true;
    }
    if (data.description !== undefined) {
      fields.description = data.description
        ? {
            type: 'doc',
            version: 1,
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: data.description }],
              },
            ],
          }
        : null;
      hasFields = true;
    }
    if (data.labels !== undefined) {
      fields.labels = data.labels;
      hasFields = true;
    }
    if (data.type !== undefined) {
      fields.issuetype = { name: titleCase(data.type) };
      hasFields = true;
    }
    if (data.assignee !== undefined) {
      fields.assignee = data.assignee ? { id: data.assignee } : null;
      hasFields = true;
    }

    if (hasFields) {
      await this.api.rest('PUT', `/api/3/issue/${id}`, { fields });
    }

    this.invalidateCache();
    return this.getWorkItem(id);
  }

  async deleteWorkItem(id: string): Promise<void> {
    await this.api.rest('DELETE', `/api/3/issue/${id}`);
    this.invalidateCache();
  }

  async addComment(workItemId: string, comment: NewComment): Promise<Comment> {
    await this.api.rest('POST', `/api/3/issue/${workItemId}/comment`, {
      body: {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: comment.body }],
          },
        ],
      },
    });
    return {
      author: comment.author,
      date: new Date().toISOString(),
      body: comment.body,
    };
  }

  override async getChildren(id: string): Promise<WorkItem[]> {
    const issues: JiraIssue[] = [];
    for await (const page of this.api.paginate<JiraIssue>(
      `/api/3/search?jql=${encodeURIComponent(`parent = ${id}`)}&fields=*all`,
    )) {
      issues.push(...page);
    }
    return issues.map(mapIssueToWorkItem);
  }

  override async getDependents(id: string): Promise<WorkItem[]> {
    const issues: JiraIssue[] = [];
    for await (const page of this.api.paginate<JiraIssue>(
      `/api/3/search?jql=${encodeURIComponent(`issue in linkedIssues("${id}","is blocked by")`)}&fields=*all`,
    )) {
      issues.push(...page);
    }
    return issues.map(mapIssueToWorkItem);
  }

  getItemUrl(id: string): string {
    return `${this.config.site}/browse/${id}`;
  }

  async openItem(id: string): Promise<void> {
    const { default: open } = await import('open');
    await open(this.getItemUrl(id));
  }

  /* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unused-vars */
  async listTemplates(): Promise<Template[]> {
    throw new UnsupportedOperationError('templates', 'JiraBackend');
  }
  async getTemplate(_slug: string): Promise<Template> {
    throw new UnsupportedOperationError('templates', 'JiraBackend');
  }
  async createTemplate(_template: Template): Promise<Template> {
    throw new UnsupportedOperationError('templates', 'JiraBackend');
  }
  async updateTemplate(
    _oldSlug: string,
    _template: Template,
  ): Promise<Template> {
    throw new UnsupportedOperationError('templates', 'JiraBackend');
  }
  async deleteTemplate(_slug: string): Promise<void> {
    throw new UnsupportedOperationError('templates', 'JiraBackend');
  }
  /* eslint-enable @typescript-eslint/require-await, @typescript-eslint/no-unused-vars */

  private async fetchSprints(): Promise<JiraSprint[]> {
    if (this.cachedSprints) return this.cachedSprints;
    const response = await this.api.rest<{ values: JiraSprint[] }>(
      'GET',
      `/agile/1.0/board/${this.config.boardId}/sprint`,
    );
    this.cachedSprints = response.values;
    return this.cachedSprints;
  }
}
```

**Step 3: Run build to check for type errors**

Run: `npm run build`
Expected: No type errors.

**Step 4: Commit**

```bash
git add src/backends/jira/index.ts src/backends/jira/mappers.ts
git commit -m "feat(jira): rewrite JiraBackend to use REST API v3 instead of acli"
```

---

### Task 4: Rewrite JiraBackend Tests

**Files:**
- Modify: `src/backends/jira/jira.test.ts` — re-mock from `acli` to `JiraApiClient`
- Modify: `src/backends/jira/mappers.test.ts` — add `adfToText` tests, update description type

**Step 1: Update `mappers.test.ts` for ADF**

Add tests for `adfToText`. Update `mapIssueToWorkItem` test to use ADF description object instead of plain string. Update `mapCommentToComment` test to use ADF body.

**Step 2: Rewrite `jira.test.ts`**

Replace all `vi.mock('./acli.js')` with `vi.mock('./api.js')` and `vi.mock('../../auth/jira.js')`. Mock the `JiraApiClient` class and `getJiraCredentials`. The test structure stays the same (same describe blocks, same behavioral assertions), but mock calls change from `mockAcli(args, cwd)` to `mockApi.rest(method, path, body)`.

Key changes:
- `vi.mock('./acli.js')` → `vi.mock('./api.js')` + `vi.mock('../../auth/jira.js')`
- `mockAcliExecSync` auth check → `mockGetJiraCredentials` returns credentials, `mockApi.rest` validates `/api/3/myself`
- `mockAcli.mockResolvedValue(issues)` → `mockApi.rest.mockResolvedValue(...)` (note: search returns `{ issues: [...], startAt, maxResults, total }`, not bare array)
- `mockAcliExec` for transitions → `mockApi.rest` for `GET transitions` + `POST transitions`
- Sprint fetching returns `{ values: [...] }` wrapper
- Comment fetching returns `{ comments: [...] }` wrapper
- `openItem` now uses `open` package instead of `acliExec`

**Step 3: Run tests to verify they pass**

Run: `npx vitest run src/backends/jira/jira.test.ts src/backends/jira/mappers.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/backends/jira/jira.test.ts src/backends/jira/mappers.test.ts
git commit -m "test(jira): rewrite backend tests for REST API mocks"
```

---

### Task 5: Delete acli Module

**Files:**
- Delete: `src/backends/jira/acli.ts`
- Delete: `src/backends/jira/acli.test.ts`

**Step 1: Delete the files**

```bash
rm src/backends/jira/acli.ts src/backends/jira/acli.test.ts
```

**Step 2: Verify no remaining imports of acli**

Run: `grep -r "from.*acli" src/backends/jira/`
Expected: No output (no remaining references to acli module).

**Step 3: Run full test suite**

Run: `npx vitest run src/backends/jira/`
Expected: All Jira tests pass.

**Step 4: Commit**

```bash
git add -u src/backends/jira/
git commit -m "chore(jira): remove acli CLI wrapper"
```

---

### Task 6: CLI Auth Commands for Jira

**Files:**
- Modify: `src/cli/commands/auth.ts`

**Step 1: Write integration expectations**

The changes needed in `src/cli/commands/auth.ts`:
- Add `'jira'` to `VALID_PROVIDERS`
- Import `getJiraCredentials`, `setJiraCredentials`, `removeJiraCredentials` from `../../auth/jira.js`
- `runAuthLogin('jira')` — prompts for site, email, token; validates with `GET /api/3/myself`; stores in keychain
- `runAuthStatus()` — add Jira entry checking `getJiraCredentials` for all stored Jira accounts
- `runAuthLogout('jira')` — calls `removeJiraCredentials`

**Step 2: Update `VALID_PROVIDERS` and add Jira login/logout/status**

In `src/cli/commands/auth.ts`:

Add to `VALID_PROVIDERS`:
```typescript
const VALID_PROVIDERS = ['github', 'azure', 'ado', 'gitlab', 'jira'] as const;
```

Add imports:
```typescript
import {
  getJiraCredentials,
  setJiraCredentials,
  removeJiraCredentials,
  JIRA_ACCOUNT_PREFIX,
} from '../../auth/jira.js';
import { JiraApiClient } from '../../backends/jira/api.js';
```

Add `'jira'` case in `runAuthLogin`:
```typescript
case 'jira': {
  const site = await readLine('Jira site (e.g. mycompany.atlassian.net): ');
  const email = await readLine('Email: ');
  const token = await readLine('API token: ');
  // Validate
  const api = new JiraApiClient(email, token, site);
  await api.rest('GET', '/api/3/myself');
  setJiraCredentials(site, email, token);
  return token;
}
```

Add Jira to `runAuthStatus` results:
```typescript
// In runAuthStatus(), read Jira credential state from keychain
// Note: Jira credentials are per-site, so we need to check config
// For status, we report based on configStore's jira.site if available
```

Add `'jira'` case in `runAuthLogout`:
```typescript
case 'jira': {
  const config = configStore.getState().config;
  const site = config.jira?.site;
  if (site) {
    removeJiraCredentials(site.replace(/^https?:\/\//, ''));
  }
  break;
}
```

**Step 3: Run build to check types**

Run: `npm run build`
Expected: No errors.

**Step 4: Commit**

```bash
git add src/cli/commands/auth.ts
git commit -m "feat(jira): add Jira provider to CLI auth commands"
```

---

### Task 7: Factory and BackendDataStore Integration

**Files:**
- Modify: `src/backends/factory.ts` — pass `skipAuth` option to `JiraBackend.create()`
- Modify: `src/stores/backendDataStore.ts` — add Jira auth flow support (email+token form)

**Step 1: Update factory.ts**

In `src/backends/factory.ts`, change the Jira case in `createRemoteBackend`:

```typescript
case 'jira': {
  const { JiraBackend } = await import('./jira/index.js');
  return JiraBackend.create(root, options);
}
```

This passes through the `{ skipAuth }` option which `JiraBackend.create` now accepts.

**Step 2: Update backendDataStore.ts for Jira auth**

In `startAuthFlow`, add a `'jira'` case. Unlike GitHub/ADO which use device code flow, Jira needs email + token input (no polling). The flow:
- Set `authFlow.state = 'entering-jira-credentials'` (new state)
- AuthPrompt renders email + token inputs
- On submit, validate with API, store in keychain, create remote backend

Add `'entering-jira-credentials'` to `AuthFlowState.state` union.

Add a new `submitJiraCredentials(site, email, token)` method:
```typescript
async submitJiraCredentials(site: string, email: string, token: string) {
  // Similar to submitAdoPat but for Jira:
  // 1. Validate with JiraApiClient
  // 2. Store credentials
  // 3. Create remote backend and sync
}
```

In `startAuthFlow`, add:
```typescript
case 'jira': {
  set({ authFlow: { state: 'entering-jira-credentials' } });
  return; // Wait for form submission
}
```

**Step 3: Run build**

Run: `npm run build`
Expected: No errors.

**Step 4: Commit**

```bash
git add src/backends/factory.ts src/stores/backendDataStore.ts
git commit -m "feat(jira): integrate Jira auth into factory and backendDataStore"
```

---

### Task 8: AuthPrompt — Jira Email + Token Form

**Files:**
- Modify: `src/components/AuthPrompt.tsx`

**Step 1: Add Jira credentials form branch**

Add a new state check for `authFlow?.state === 'entering-jira-credentials'`. Render:
- Email input (plain `TextInput`)
- API token input (masked `TextInput`)
- Hint text about generating tokens at `https://id.atlassian.com/manage-profile/security/api-tokens`
- Submit handler calls `backendDataStore.getState().submitJiraCredentials(site, email, token)`

The site comes from `configStore` (already configured in Settings screen).

Also update the initial prompt screen to show `enter authenticate` for Jira (no PAT option — Jira only has API token auth, which is the primary flow).

**Step 2: Run build**

Run: `npm run build`
Expected: No errors.

**Step 3: Commit**

```bash
git add src/components/AuthPrompt.tsx
git commit -m "feat(jira): add email+token authentication form to AuthPrompt"
```

---

### Task 9: Update Availability Check

**Files:**
- Modify: `src/backends/availability.ts`

**Step 1: Verify no changes needed**

The `BACKEND_CLI` mapping already has `jira: null`, meaning no CLI tool is required. The `checkBackendAvailability` function returns `true` for `null` CLI. This is already correct.

No code changes needed — just verify.

**Step 2: Verify**

Run: `npx vitest run src/backends/availability` (if tests exist)
Expected: PASS or no tests to run.

---

### Task 10: Full Verification

**Step 1: Run the full test suite**

Run: `npm test`
Expected: All tests pass.

**Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors.

**Step 3: Run lint and format**

Run: `npm run lint && npm run format:check`
Expected: No errors.

**Step 4: Final commit if any formatting fixes needed**

Run: `npm run format` if format:check fails, then:
```bash
git add -u
git commit -m "chore: format"
```
