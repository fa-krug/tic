# GitLab API Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate the GitLab backend from `glab` CLI to direct GraphQL API via the Work Items API, add OAuth device flow auth, and remove the `glab` dependency.

**Architecture:** New `GitLabApiClient` extends `BaseApiClient` with GraphQL-only access to `gitlab.com/api/graphql`. Both issues and epics use the Work Items API. Auth via OAuth device flow (gitlab.com) with PAT fallback. Templates via local filesystem instead of Repository Files API.

**Tech Stack:** TypeScript, Vitest, `@napi-rs/keyring` (keychain), GitLab GraphQL API (Work Items)

---

## Task 1: Auth Module (`src/auth/gitlab.ts`)

**Files:**
- Create: `src/auth/gitlab.ts`
- Create: `src/auth/gitlab.test.ts`
- Reference: `src/auth/github.ts` (pattern to follow)
- Reference: `src/auth/keychain.ts` (token storage)

**Step 1: Write the failing tests**

Create `src/auth/gitlab.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockGetToken, mockSetToken, mockDeleteToken } = vi.hoisted(() => ({
  mockGetToken: vi.fn(),
  mockSetToken: vi.fn(),
  mockDeleteToken: vi.fn(),
}));

vi.mock('./keychain.js', () => ({
  getToken: mockGetToken,
  setToken: mockSetToken,
  deleteToken: mockDeleteToken,
}));

import {
  GITLAB_ACCOUNT,
  GITLAB_PAT_ACCOUNT,
  DEFAULT_GITLAB_CLIENT_ID,
  getGitLabToken,
  getGitLabPat,
  setGitLabPat,
  clearGitLabTokens,
  authenticateGitLab,
} from './gitlab.js';

describe('gitlab auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('exports correct account constants', () => {
    expect(GITLAB_ACCOUNT).toBe('gitlab.com');
    expect(GITLAB_PAT_ACCOUNT).toBe('gitlab.com:pat');
    expect(DEFAULT_GITLAB_CLIENT_ID).toBe(
      'cdcaceeece0df785f6df0e8b94fce6669ec8521787844faed02a5605b29e05bd',
    );
  });

  describe('getGitLabToken', () => {
    it('returns token from keychain', () => {
      mockGetToken.mockReturnValue('oauth-token');
      expect(getGitLabToken()).toBe('oauth-token');
      expect(mockGetToken).toHaveBeenCalledWith('gitlab.com');
    });

    it('returns null when no token', () => {
      mockGetToken.mockReturnValue(null);
      expect(getGitLabToken()).toBeNull();
    });
  });

  describe('getGitLabPat', () => {
    it('returns PAT from keychain', () => {
      mockGetToken.mockReturnValue('glpat-xxx');
      expect(getGitLabPat()).toBe('glpat-xxx');
      expect(mockGetToken).toHaveBeenCalledWith('gitlab.com:pat');
    });
  });

  describe('setGitLabPat', () => {
    it('stores PAT in keychain', () => {
      setGitLabPat('glpat-xxx');
      expect(mockSetToken).toHaveBeenCalledWith('gitlab.com:pat', 'glpat-xxx');
    });
  });

  describe('clearGitLabTokens', () => {
    it('deletes both oauth and pat tokens', () => {
      clearGitLabTokens();
      expect(mockDeleteToken).toHaveBeenCalledWith('gitlab.com');
      expect(mockDeleteToken).toHaveBeenCalledWith('gitlab.com:pat');
    });
  });

  describe('authenticateGitLab', () => {
    function mockFetchResponses(...responses: Array<{ status: number; body: unknown }>) {
      const mockFetch = vi.fn();
      for (const r of responses) {
        mockFetch.mockResolvedValueOnce({
          ok: r.status >= 200 && r.status < 300,
          status: r.status,
          json: vi.fn().mockResolvedValue(r.body),
        });
      }
      vi.stubGlobal('fetch', mockFetch);
      return mockFetch;
    }

    it('runs device flow and stores token on success', async () => {
      const mockFetch = mockFetchResponses(
        {
          status: 200,
          body: {
            device_code: 'dev123',
            user_code: 'ABCD-1234',
            verification_uri: 'https://gitlab.com/oauth/device',
            expires_in: 900,
            interval: 5,
          },
        },
        {
          status: 200,
          body: { access_token: 'gltok-abc', token_type: 'Bearer', scope: 'api' },
        },
      );

      const onCode = vi.fn();
      const promise = authenticateGitLab({ onCode });
      await vi.advanceTimersByTimeAsync(5000);
      const token = await promise;

      expect(onCode).toHaveBeenCalledWith('ABCD-1234', 'https://gitlab.com/oauth/device');
      expect(token).toBe('gltok-abc');
      expect(mockSetToken).toHaveBeenCalledWith('gitlab.com', 'gltok-abc');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('handles authorization_pending by polling again', async () => {
      const mockFetch = mockFetchResponses(
        {
          status: 200,
          body: {
            device_code: 'dev123',
            user_code: 'ABCD-1234',
            verification_uri: 'https://gitlab.com/oauth/device',
            expires_in: 900,
            interval: 5,
          },
        },
        { status: 200, body: { error: 'authorization_pending' } },
        {
          status: 200,
          body: { access_token: 'gltok-abc', token_type: 'Bearer', scope: 'api' },
        },
      );

      const promise = authenticateGitLab();
      await vi.advanceTimersByTimeAsync(5000); // first poll — pending
      await vi.advanceTimersByTimeAsync(5000); // second poll — success
      await promise;

      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('increases interval on slow_down', async () => {
      const mockFetch = mockFetchResponses(
        {
          status: 200,
          body: {
            device_code: 'dev123',
            user_code: 'ABCD-1234',
            verification_uri: 'https://gitlab.com/oauth/device',
            expires_in: 900,
            interval: 5,
          },
        },
        { status: 200, body: { error: 'slow_down' } },
        {
          status: 200,
          body: { access_token: 'gltok-abc', token_type: 'Bearer', scope: 'api' },
        },
      );

      const promise = authenticateGitLab();
      await vi.advanceTimersByTimeAsync(5000); // first poll — slow_down
      await vi.advanceTimersByTimeAsync(10000); // second poll with +5s — success
      await promise;

      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('throws on access_denied', async () => {
      mockFetchResponses(
        {
          status: 200,
          body: {
            device_code: 'dev123',
            user_code: 'X',
            verification_uri: 'https://gitlab.com/oauth/device',
            expires_in: 900,
            interval: 5,
          },
        },
        { status: 200, body: { error: 'access_denied' } },
      );

      const promise = authenticateGitLab();
      await vi.advanceTimersByTimeAsync(5000);
      await expect(promise).rejects.toThrow('denied');
    });

    it('throws on expired_token', async () => {
      mockFetchResponses(
        {
          status: 200,
          body: {
            device_code: 'dev123',
            user_code: 'X',
            verification_uri: 'https://gitlab.com/oauth/device',
            expires_in: 900,
            interval: 5,
          },
        },
        { status: 200, body: { error: 'expired_token' } },
      );

      const promise = authenticateGitLab();
      await vi.advanceTimersByTimeAsync(5000);
      await expect(promise).rejects.toThrow('expired');
    });

    it('uses custom client ID', async () => {
      const mockFetch = mockFetchResponses(
        {
          status: 200,
          body: {
            device_code: 'dev123',
            user_code: 'X',
            verification_uri: 'https://gitlab.com/oauth/device',
            expires_in: 900,
            interval: 5,
          },
        },
        {
          status: 200,
          body: { access_token: 'tok', token_type: 'Bearer', scope: 'api' },
        },
      );

      const promise = authenticateGitLab({ clientId: 'custom-id' });
      await vi.advanceTimersByTimeAsync(5000);
      await promise;

      const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
      expect(body.client_id).toBe('custom-id');
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/auth/gitlab.test.ts`
Expected: FAIL — module `./gitlab.js` not found

**Step 3: Write the implementation**

Create `src/auth/gitlab.ts` following the exact pattern from `src/auth/github.ts`:

```typescript
import { getToken, setToken, deleteToken } from './keychain.js';

export const GITLAB_ACCOUNT = 'gitlab.com';
export const GITLAB_PAT_ACCOUNT = 'gitlab.com:pat';
export const DEFAULT_GITLAB_CLIENT_ID =
  'cdcaceeece0df785f6df0e8b94fce6669ec8521787844faed02a5605b29e05bd';

export function getGitLabToken(): string | null {
  return getToken(GITLAB_ACCOUNT);
}

export function getGitLabPat(): string | null {
  return getToken(GITLAB_PAT_ACCOUNT);
}

export function setGitLabPat(pat: string): void {
  setToken(GITLAB_PAT_ACCOUNT, pat);
}

export function clearGitLabTokens(): void {
  deleteToken(GITLAB_ACCOUNT);
  deleteToken(GITLAB_PAT_ACCOUNT);
}

export interface AuthenticateGitLabOptions {
  clientId?: string;
  onCode?: (userCode: string, verificationUri: string) => void;
}

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

interface TokenSuccessResponse {
  access_token: string;
  token_type: string;
  scope: string;
}

interface TokenErrorResponse {
  error: string;
  error_description?: string;
}

type TokenPollResponse = TokenSuccessResponse | TokenErrorResponse;

function isTokenError(
  response: TokenPollResponse,
): response is TokenErrorResponse {
  return 'error' in response;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function authenticateGitLab(
  options?: AuthenticateGitLabOptions,
): Promise<string> {
  const clientId = options?.clientId ?? DEFAULT_GITLAB_CLIENT_ID;

  const codeResponse = await fetch(
    'https://gitlab.com/oauth/authorize_device',
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        scope: 'api',
      }),
    },
  );

  if (!codeResponse.ok) {
    throw new Error(
      `Failed to request device code: ${codeResponse.status} ${codeResponse.statusText}`,
    );
  }

  const deviceCode = (await codeResponse.json()) as DeviceCodeResponse;

  options?.onCode?.(deviceCode.user_code, deviceCode.verification_uri);

  let interval = deviceCode.interval * 1000;

  while (true) {
    await sleep(interval);

    const tokenResponse = await fetch('https://gitlab.com/oauth/token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        device_code: deviceCode.device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });

    if (!tokenResponse.ok) {
      throw new Error(
        `Failed to poll for token: ${tokenResponse.status} ${tokenResponse.statusText}`,
      );
    }

    const data = (await tokenResponse.json()) as TokenPollResponse;

    if (isTokenError(data)) {
      switch (data.error) {
        case 'authorization_pending':
          continue;
        case 'slow_down':
          interval += 5000;
          continue;
        case 'access_denied':
          throw new Error('Authorization was denied by the user');
        case 'expired_token':
          throw new Error(
            'Device code has expired. Please restart the authentication flow.',
          );
        default:
          throw new Error(
            `Authentication failed: ${data.error}${data.error_description ? ` - ${data.error_description}` : ''}`,
          );
      }
    }

    setToken(GITLAB_ACCOUNT, data.access_token);
    return data.access_token;
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/auth/gitlab.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/auth/gitlab.ts src/auth/gitlab.test.ts
git commit -m "feat(auth): add GitLab OAuth device flow and PAT support"
```

---

## Task 2: Remote Detection (`src/backends/gitlab/remote.ts`)

**Files:**
- Rename: `src/backends/gitlab/group.ts` → `src/backends/gitlab/remote.ts`
- Rename: `src/backends/gitlab/group.test.ts` → `src/backends/gitlab/remote.test.ts`

**Step 1: Write the updated tests**

Rename `group.test.ts` to `remote.test.ts` and update to test `GitLabRemoteInfo`:

```typescript
import { describe, it, expect, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

import { execSync } from 'node:child_process';
import { parseGitLabRemote } from './remote.js';
import type { GitLabRemoteInfo } from './remote.js';

describe('parseGitLabRemote', () => {
  it('parses SSH remote', () => {
    vi.mocked(execSync).mockReturnValue(
      'origin\tgit@gitlab.com:mygroup/myproject.git (fetch)\n',
    );
    const info = parseGitLabRemote('/tmp');
    expect(info).toEqual<GitLabRemoteInfo>({
      host: 'gitlab.com',
      group: 'mygroup',
      project: 'myproject',
      fullPath: 'mygroup/myproject',
    });
  });

  it('parses HTTPS remote', () => {
    vi.mocked(execSync).mockReturnValue(
      'origin\thttps://gitlab.com/mygroup/myproject.git (fetch)\n',
    );
    const info = parseGitLabRemote('/tmp');
    expect(info).toEqual<GitLabRemoteInfo>({
      host: 'gitlab.com',
      group: 'mygroup',
      project: 'myproject',
      fullPath: 'mygroup/myproject',
    });
  });

  it('parses nested subgroups', () => {
    vi.mocked(execSync).mockReturnValue(
      'origin\tgit@gitlab.com:org/team/subteam/myproject.git (fetch)\n',
    );
    const info = parseGitLabRemote('/tmp');
    expect(info).toEqual<GitLabRemoteInfo>({
      host: 'gitlab.com',
      group: 'org/team/subteam',
      project: 'myproject',
      fullPath: 'org/team/subteam/myproject',
    });
  });

  it('throws when no GitLab remote found', () => {
    vi.mocked(execSync).mockReturnValue(
      'origin\tgit@github.com:user/repo.git (fetch)\n',
    );
    expect(() => parseGitLabRemote('/tmp')).toThrow('No GitLab remote found');
  });

  it('throws on invalid remote path', () => {
    vi.mocked(execSync).mockReturnValue(
      'origin\tgit@gitlab.com:onlyone.git (fetch)\n',
    );
    expect(() => parseGitLabRemote('/tmp')).toThrow('Invalid GitLab remote path');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/backends/gitlab/remote.test.ts`
Expected: FAIL — module `./remote.js` not found

**Step 3: Write the implementation**

Create `src/backends/gitlab/remote.ts`:

```typescript
import { execSync } from 'node:child_process';

export interface GitLabRemoteInfo {
  host: string;
  group: string;
  project: string;
  fullPath: string;
}

export function parseGitLabRemote(cwd: string): GitLabRemoteInfo {
  const output = execSync('git remote -v', {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const lines = output.split('\n');
  for (const line of lines) {
    // SSH: git@gitlab.com:group/subgroup/project.git
    const sshMatch = line.match(/gitlab\.com:(.+?)\.git/);
    if (sshMatch) {
      return parseFullPath('gitlab.com', sshMatch[1]!);
    }

    // HTTPS: https://gitlab.com/group/subgroup/project.git
    const httpsMatch = line.match(/gitlab\.com\/(.+?)\.git/);
    if (httpsMatch) {
      return parseFullPath('gitlab.com', httpsMatch[1]!);
    }
  }

  throw new Error('No GitLab remote found in git remotes');
}

function parseFullPath(host: string, fullPath: string): GitLabRemoteInfo {
  const segments = fullPath.split('/');
  if (segments.length < 2) {
    throw new Error(
      `Invalid GitLab remote path: ${fullPath} (expected group/project)`,
    );
  }
  const project = segments[segments.length - 1]!;
  const group = segments.slice(0, -1).join('/');
  return { host, group, project, fullPath };
}
```

**Step 4: Delete old files**

Delete `src/backends/gitlab/group.ts` and `src/backends/gitlab/group.test.ts`.

**Step 5: Run tests to verify they pass**

Run: `npx vitest run src/backends/gitlab/remote.test.ts`
Expected: All tests PASS

**Step 6: Commit**

```bash
git add src/backends/gitlab/remote.ts src/backends/gitlab/remote.test.ts
git rm src/backends/gitlab/group.ts src/backends/gitlab/group.test.ts
git commit -m "refactor(gitlab): rename group.ts to remote.ts with GitLabRemoteInfo"
```

---

## Task 3: API Client (`src/backends/gitlab/api.ts`)

**Files:**
- Create: `src/backends/gitlab/api.ts`
- Create: `src/backends/gitlab/api.test.ts`
- Reference: `src/backends/github/api.ts` (pattern to follow)
- Reference: `src/backends/shared/api-client.ts` (base class)

**Step 1: Write the failing tests**

Create `src/backends/gitlab/api.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitLabApiClient } from './api.js';

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
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  } as unknown as Response;
}

describe('GitLabApiClient', () => {
  let client: GitLabApiClient;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    client = new GitLabApiClient('test-token');
  });

  describe('graphql', () => {
    it('sends POST to /api/graphql with correct headers', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockResponse(200, {
          data: { project: { name: 'test' } },
        }),
      );
      vi.stubGlobal('fetch', mockFetch);

      const result = await client.graphql<{ project: { name: string } }>(
        'query { project { name } }',
      );

      expect(result).toEqual({ project: { name: 'test' } });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://gitlab.com/api/graphql',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            query: 'query { project { name } }',
          }),
        }),
      );

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers.Authorization).toBe('Bearer test-token');
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('sends variables when provided', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockResponse(200, { data: { workItem: { id: '1' } } }),
      );
      vi.stubGlobal('fetch', mockFetch);

      await client.graphql('query($id: ID!) { workItem(id: $id) { id } }', {
        id: 'gid://gitlab/WorkItem/1',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.variables).toEqual({ id: 'gid://gitlab/WorkItem/1' });
    });

    it('throws on 401', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(mockResponse(401, { error: 'unauthorized' })),
      );

      await expect(
        client.graphql('query { viewer { name } }'),
      ).rejects.toThrow('AuthError');
    });

    it('throws on GraphQL errors', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          mockResponse(200, {
            errors: [{ message: 'Field not found' }],
          }),
        ),
      );

      await expect(
        client.graphql('query { bad }'),
      ).rejects.toThrow('GraphQL error: Field not found');
    });
  });

  describe('paginate', () => {
    it('yields nodes across multiple pages', async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce(
          mockResponse(200, {
            data: {
              project: {
                workItems: {
                  nodes: [{ id: '1' }, { id: '2' }],
                  pageInfo: { hasNextPage: true, endCursor: 'cursor1' },
                },
              },
            },
          }),
        )
        .mockResolvedValueOnce(
          mockResponse(200, {
            data: {
              project: {
                workItems: {
                  nodes: [{ id: '3' }],
                  pageInfo: { hasNextPage: false, endCursor: 'cursor2' },
                },
              },
            },
          }),
        );
      vi.stubGlobal('fetch', mockFetch);

      type Resp = {
        project: {
          workItems: {
            nodes: Array<{ id: string }>;
            pageInfo: { hasNextPage: boolean; endCursor: string };
          };
        };
      };

      const allNodes: Array<{ id: string }> = [];
      for await (const page of client.paginate<Resp>(
        'query($cursor: String) { project { workItems(after: $cursor) { nodes { id } pageInfo { hasNextPage endCursor } } } }',
        {},
        (data) => data.project.workItems,
      )) {
        allNodes.push(...page);
      }

      expect(allNodes).toEqual([{ id: '1' }, { id: '2' }, { id: '3' }]);
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Verify second call includes cursor
      const secondBody = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(secondBody.variables.after).toBe('cursor1');
    });

    it('handles single page', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          mockResponse(200, {
            data: {
              items: {
                nodes: [{ id: '1' }],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          }),
        ),
      );

      type Resp = {
        items: {
          nodes: Array<{ id: string }>;
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
        };
      };

      const allNodes: Array<{ id: string }> = [];
      for await (const page of client.paginate<Resp>(
        'query { items { nodes { id } pageInfo { hasNextPage endCursor } } }',
        {},
        (data) => data.items,
      )) {
        allNodes.push(...page);
      }

      expect(allNodes).toEqual([{ id: '1' }]);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/backends/gitlab/api.test.ts`
Expected: FAIL — module `./api.js` not found

**Step 3: Write the implementation**

Create `src/backends/gitlab/api.ts`:

```typescript
import { AuthError, BaseApiClient } from '../shared/api-client.js';

interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

interface Connection<T> {
  nodes: T[];
  pageInfo: PageInfo;
}

export class GitLabApiClient extends BaseApiClient {
  constructor(token: string) {
    super(token, 'https://gitlab.com');
  }

  async graphql<T>(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<T> {
    return this.retry(() => this.graphqlFetch<T>(query, variables));
  }

  private async graphqlFetch<T>(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<T> {
    const url = this.baseUrl + '/api/graphql';

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };

    const body: Record<string, unknown> = { query };
    if (variables) {
      body.variables = variables;
    }

    const response = await globalThis.fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (response.status === 401) {
      throw new AuthError();
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text}`);
    }

    const json = (await response.json()) as {
      data?: T;
      errors?: Array<{ message: string }>;
    };

    const firstError = json.errors?.[0];
    if (firstError) {
      throw new Error(`GraphQL error: ${firstError.message}`);
    }

    return json.data as T;
  }

  async *paginate<T>(
    query: string,
    variables: Record<string, unknown>,
    extractConnection: (data: T) => Connection<unknown>,
  ): AsyncGenerator<unknown[]> {
    let cursor: string | null = null;
    let hasNextPage = true;

    while (hasNextPage) {
      const vars = { ...variables, after: cursor };
      const data = await this.graphql<T>(query, vars);
      const connection = extractConnection(data);

      yield connection.nodes;

      hasNextPage = connection.pageInfo.hasNextPage;
      cursor = connection.pageInfo.endCursor;
    }
  }

  // Required by abstract base — not used since we only do GraphQL
  // eslint-disable-next-line require-yield
  async *paginateRest<T>(_path: string): AsyncGenerator<T[]> {
    throw new Error('GitLab API client uses GraphQL pagination only');
  }
}
```

Note: The `paginate` abstract method on `BaseApiClient` expects `paginate<T>(path: string)`. Since GitLab doesn't use REST pagination, implement the required abstract method as a no-op and use a separate `paginate` method with GraphQL parameters. Check the exact abstract signature in `BaseApiClient` — if it conflicts, rename the GraphQL version to `paginateGraphql` or override with different signature. Adjust as needed during implementation.

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/backends/gitlab/api.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/backends/gitlab/api.ts src/backends/gitlab/api.test.ts
git commit -m "feat(gitlab): add GitLabApiClient with GraphQL and cursor pagination"
```

---

## Task 4: Mappers (`src/backends/gitlab/mappers.ts`)

**Files:**
- Rewrite: `src/backends/gitlab/mappers.ts`
- Rewrite: `src/backends/gitlab/mappers.test.ts` (may not exist — create if needed)

**Step 1: Write the failing tests**

The Work Items API returns widgets in a `widgets` array with `__typename` discriminators. Write tests for the new mapper:

```typescript
import { describe, it, expect } from 'vitest';
import {
  mapWorkItemToWorkItem,
  mapNoteToComment,
} from './mappers.js';
import type { GlWorkItem, GlNote } from './mappers.js';

describe('mapWorkItemToWorkItem', () => {
  it('maps an issue work item with all widgets', () => {
    const workItem: GlWorkItem = {
      id: 'gid://gitlab/WorkItem/100',
      iid: '42',
      title: 'Fix login bug',
      state: 'OPEN',
      workItemType: { name: 'Issue' },
      widgets: [
        {
          __typename: 'WorkItemWidgetDescription',
          description: 'Detailed description here',
        },
        {
          __typename: 'WorkItemWidgetAssignees',
          assignees: { nodes: [{ username: 'alice' }] },
        },
        {
          __typename: 'WorkItemWidgetLabels',
          labels: { nodes: [{ title: 'bug' }, { title: 'urgent' }] },
        },
        {
          __typename: 'WorkItemWidgetMilestone',
          milestone: { title: 'Sprint 1' },
        },
        {
          __typename: 'WorkItemWidgetHierarchy',
          parent: { id: 'gid://gitlab/WorkItem/10', iid: '5', workItemType: { name: 'Epic' } },
        },
        {
          __typename: 'WorkItemWidgetNotes',
          discussions: {
            nodes: [
              {
                notes: {
                  nodes: [
                    { author: { username: 'bob' }, createdAt: '2025-01-01T00:00:00Z', body: 'Looks good' },
                  ],
                },
              },
            ],
          },
        },
      ],
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-02T00:00:00Z',
    };

    const result = mapWorkItemToWorkItem(workItem);
    expect(result).toEqual({
      id: 'issue-42',
      title: 'Fix login bug',
      description: 'Detailed description here',
      status: 'open',
      type: 'issue',
      assignee: 'alice',
      labels: ['bug', 'urgent'],
      iteration: 'Sprint 1',
      priority: 'medium',
      created: '2025-01-01T00:00:00Z',
      updated: '2025-01-02T00:00:00Z',
      parent: 'epic-5',
      dependsOn: [],
      comments: [
        { author: 'bob', date: '2025-01-01T00:00:00Z', body: 'Looks good' },
      ],
    });
  });

  it('maps an epic work item', () => {
    const workItem: GlWorkItem = {
      id: 'gid://gitlab/WorkItem/200',
      iid: '10',
      title: 'Q1 Planning',
      state: 'OPEN',
      workItemType: { name: 'Epic' },
      widgets: [
        { __typename: 'WorkItemWidgetDescription', description: '' },
        { __typename: 'WorkItemWidgetLabels', labels: { nodes: [] } },
      ],
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-02T00:00:00Z',
    };

    const result = mapWorkItemToWorkItem(workItem);
    expect(result.id).toBe('epic-10');
    expect(result.type).toBe('epic');
    expect(result.parent).toBeNull();
    expect(result.assignee).toBe('');
  });

  it('maps CLOSED state to closed', () => {
    const workItem: GlWorkItem = {
      id: 'gid://gitlab/WorkItem/300',
      iid: '99',
      title: 'Done',
      state: 'CLOSED',
      workItemType: { name: 'Issue' },
      widgets: [],
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-02T00:00:00Z',
    };

    expect(mapWorkItemToWorkItem(workItem).status).toBe('closed');
  });

  it('handles missing widgets gracefully', () => {
    const workItem: GlWorkItem = {
      id: 'gid://gitlab/WorkItem/400',
      iid: '1',
      title: 'Minimal',
      state: 'OPEN',
      workItemType: { name: 'Issue' },
      widgets: [],
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-02T00:00:00Z',
    };

    const result = mapWorkItemToWorkItem(workItem);
    expect(result.description).toBe('');
    expect(result.assignee).toBe('');
    expect(result.labels).toEqual([]);
    expect(result.iteration).toBe('');
    expect(result.parent).toBeNull();
    expect(result.comments).toEqual([]);
  });
});

describe('mapNoteToComment', () => {
  it('maps a note to a comment', () => {
    const note: GlNote = {
      author: { username: 'alice' },
      createdAt: '2025-01-01T00:00:00Z',
      body: 'Test comment',
    };

    expect(mapNoteToComment(note)).toEqual({
      author: 'alice',
      date: '2025-01-01T00:00:00Z',
      body: 'Test comment',
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/backends/gitlab/mappers.test.ts`
Expected: FAIL — imports don't match new types

**Step 3: Write the implementation**

Rewrite `src/backends/gitlab/mappers.ts`:

```typescript
import type { WorkItem, Comment } from '../../types.js';

export interface GlWorkItem {
  id: string; // gid://gitlab/WorkItem/123
  iid: string;
  title: string;
  state: string; // 'OPEN' | 'CLOSED'
  workItemType: { name: string };
  widgets: GlWidget[];
  createdAt: string;
  updatedAt: string;
}

export type GlWidget =
  | { __typename: 'WorkItemWidgetDescription'; description: string }
  | {
      __typename: 'WorkItemWidgetAssignees';
      assignees: { nodes: Array<{ username: string }> };
    }
  | {
      __typename: 'WorkItemWidgetLabels';
      labels: { nodes: Array<{ title: string }> };
    }
  | {
      __typename: 'WorkItemWidgetMilestone';
      milestone: { title: string } | null;
    }
  | {
      __typename: 'WorkItemWidgetHierarchy';
      parent: {
        id: string;
        iid: string;
        workItemType: { name: string };
      } | null;
    }
  | {
      __typename: 'WorkItemWidgetNotes';
      discussions: {
        nodes: Array<{
          notes: { nodes: GlNote[] };
        }>;
      };
    }
  | { __typename: string };

export interface GlNote {
  author: { username: string };
  createdAt: string;
  body: string;
}

function findWidget<T extends GlWidget['__typename']>(
  widgets: GlWidget[],
  typeName: T,
): Extract<GlWidget, { __typename: T }> | undefined {
  return widgets.find((w) => w.__typename === typeName) as
    | Extract<GlWidget, { __typename: T }>
    | undefined;
}

function workItemTypeToTicType(name: string): string {
  return name.toLowerCase(); // 'Issue' → 'issue', 'Epic' → 'epic'
}

export function mapWorkItemToWorkItem(workItem: GlWorkItem): WorkItem {
  const type = workItemTypeToTicType(workItem.workItemType.name);

  const descWidget = findWidget(workItem.widgets, 'WorkItemWidgetDescription');
  const assigneesWidget = findWidget(workItem.widgets, 'WorkItemWidgetAssignees');
  const labelsWidget = findWidget(workItem.widgets, 'WorkItemWidgetLabels');
  const milestoneWidget = findWidget(workItem.widgets, 'WorkItemWidgetMilestone');
  const hierarchyWidget = findWidget(workItem.widgets, 'WorkItemWidgetHierarchy');
  const notesWidget = findWidget(workItem.widgets, 'WorkItemWidgetNotes');

  let parent: string | null = null;
  if (hierarchyWidget?.parent) {
    const parentType = workItemTypeToTicType(
      hierarchyWidget.parent.workItemType.name,
    );
    parent = `${parentType}-${hierarchyWidget.parent.iid}`;
  }

  const comments: Comment[] = [];
  if (notesWidget) {
    for (const discussion of notesWidget.discussions.nodes) {
      for (const note of discussion.notes.nodes) {
        comments.push(mapNoteToComment(note));
      }
    }
  }

  return {
    id: `${type}-${workItem.iid}`,
    title: workItem.title,
    description: descWidget?.description ?? '',
    status: workItem.state === 'CLOSED' ? 'closed' : 'open',
    type,
    assignee: assigneesWidget?.assignees.nodes[0]?.username ?? '',
    labels: labelsWidget?.labels.nodes.map((l) => l.title) ?? [],
    iteration: milestoneWidget?.milestone?.title ?? '',
    priority: 'medium',
    created: workItem.createdAt,
    updated: workItem.updatedAt,
    parent,
    dependsOn: [],
    comments,
  };
}

export function mapNoteToComment(note: GlNote): Comment {
  return {
    author: note.author.username,
    date: note.createdAt,
    body: note.body,
  };
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/backends/gitlab/mappers.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/backends/gitlab/mappers.ts src/backends/gitlab/mappers.test.ts
git commit -m "refactor(gitlab): rewrite mappers for Work Items widget response format"
```

---

## Task 5: Backend Rewrite (`src/backends/gitlab/index.ts`)

**Files:**
- Rewrite: `src/backends/gitlab/index.ts`
- Rewrite: `src/backends/gitlab/gitlab.test.ts`
- Delete: `src/backends/gitlab/glab.ts`
- Delete: `src/backends/gitlab/glab.test.ts`

This is the largest task. The backend class is rewritten from scratch to use `GitLabApiClient` instead of the `glab` CLI.

**Step 1: Delete old CLI wrapper**

Delete `src/backends/gitlab/glab.ts` and `src/backends/gitlab/glab.test.ts`.

**Step 2: Write tests for the new backend**

Rewrite `src/backends/gitlab/gitlab.test.ts`. Key differences from old tests:
- Mock `./api.js` instead of `./glab.js`
- Mock `./remote.js` instead of `./group.js`
- Mock `../../auth/gitlab.js` for auth
- Use `GitLabBackend.create()` instead of `new GitLabBackend()`
- Mock GraphQL responses with Work Items widget format

The test file should cover:
- `create()` factory — token resolution (keychain → PAT → device flow → skipAuth)
- `getCapabilities()` — unchanged
- `listWorkItems()` — issues + epics via Work Items query
- `getWorkItem()` — single item with comments
- `createWorkItem()` — issue and epic creation via `workItemCreate`
- `updateWorkItem()` — field updates via `workItemUpdate`
- `deleteWorkItem()` — via `workItemDelete`
- `addComment()` — via `createNote`
- `getChildren()` — hierarchy widget query
- `getAssignees()` / `getLabels()` / `getIterations()` — metadata queries
- Template operations — filesystem-based (mock `node:fs/promises`)

**Step 3: Write the implementation**

Rewrite `src/backends/gitlab/index.ts`:

Key structural changes:
- Private constructor: `private constructor(private api: GitLabApiClient, private remote: GitLabRemoteInfo, private typeIds: Map<string, string>)`
- Static `create()` factory: resolves auth → creates `GitLabApiClient` → queries work item type IDs → constructs
- All methods call `this.api.graphql()` or `this.api.paginate()` instead of `glab()`
- IID-to-GID cache: `Map<string, string>` populated from list/get responses
- Templates: `node:fs/promises` for read/write to `.gitlab/issue_templates/`
- GraphQL queries as string constants at top of file

**Key GraphQL queries to define:**

```typescript
const WORK_ITEM_TYPES_QUERY = `query($fullPath: ID!) { ... }`;
const LIST_ISSUES_QUERY = `query($fullPath: ID!, $after: String) { ... }`;
const LIST_EPICS_QUERY = `query($fullPath: ID!, $after: String) { ... }`;
const GET_WORK_ITEM_QUERY = `query($id: WorkItemID!) { ... }`;
const CREATE_WORK_ITEM_MUTATION = `mutation($input: WorkItemCreateInput!) { ... }`;
const UPDATE_WORK_ITEM_MUTATION = `mutation($input: WorkItemUpdateInput!) { ... }`;
const DELETE_WORK_ITEM_MUTATION = `mutation($input: WorkItemDeleteInput!) { ... }`;
const CREATE_NOTE_MUTATION = `mutation($input: CreateNoteInput!) { ... }`;
const LIST_MEMBERS_QUERY = `query($fullPath: ID!, $after: String) { ... }`;
const LIST_LABELS_QUERY = `query($fullPath: ID!, $after: String) { ... }`;
const LIST_MILESTONES_QUERY = `query($fullPath: ID!, $after: String) { ... }`;
```

**Important**: The exact field names in widget inputs (`assigneesWidget`, `labelsWidget`, `milestoneWidget`, `hierarchyWidget`, `descriptionWidget`) need to be verified against GitLab's GraphQL schema during implementation. Use the GraphiQL explorer at `https://gitlab.com/-/graphql-explorer` to confirm. If any widget input names differ, adjust accordingly.

**Step 4: Run tests**

Run: `npx vitest run src/backends/gitlab/gitlab.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git rm src/backends/gitlab/glab.ts src/backends/gitlab/glab.test.ts
git add src/backends/gitlab/index.ts src/backends/gitlab/gitlab.test.ts
git commit -m "feat(gitlab)!: migrate backend from glab CLI to direct GraphQL API"
```

---

## Task 6: Factory & Store Integration

**Files:**
- Modify: `src/backends/factory.ts:69-72`
- Modify: `src/stores/backendDataStore.ts:273-291`
- Modify: `src/cli/commands/auth.ts`
- Modify: `src/cli/index.ts:533` (auth command provider list)

**Step 1: Update factory.ts**

Change the GitLab case in `createRemoteBackend()` from direct constructor to static factory:

```typescript
// src/backends/factory.ts:69-72
// Before:
case 'gitlab': {
  const { GitLabBackend } = await import('./gitlab/index.js');
  return new GitLabBackend(root);
}

// After:
case 'gitlab': {
  const { GitLabBackend } = await import('./gitlab/index.js');
  return GitLabBackend.create(root, options);
}
```

**Step 2: Update backendDataStore startAuthFlow**

Make `startAuthFlow()` dispatch based on `authPrompt.backendType` instead of hardcoding GitHub:

```typescript
// src/stores/backendDataStore.ts — in startAuthFlow()
// Replace the hardcoded authenticateGitHub call with:

const onCode = (userCode: string, verificationUri: string) => {
  set({
    authFlow: {
      state: 'code-ready',
      userCode,
      verificationUri,
    },
  });
};

switch (authPrompt.backendType) {
  case 'github': {
    const { authenticateGitHub } = await import('../auth/github.js');
    await authenticateGitHub({ onCode });
    break;
  }
  case 'gitlab': {
    const { authenticateGitLab } = await import('../auth/gitlab.js');
    await authenticateGitLab({ onCode });
    break;
  }
  case 'azure': {
    const { authenticateAdo } = await import('../auth/ado.js');
    await authenticateAdo({ onCode });
    break;
  }
  default:
    throw new Error(`Unsupported auth backend: ${authPrompt.backendType}`);
}
```

**Step 3: Update CLI auth commands**

In `src/cli/commands/auth.ts`:
- Add `'gitlab'` to `VALID_PROVIDERS`
- Add `case 'gitlab'` to `runAuthLogin()` (device flow + PAT option)
- Add GitLab to `runAuthStatus()` (check both token and PAT)
- Add `case 'gitlab'` to `runAuthLogout()` (call `clearGitLabTokens()`)

In `src/cli/index.ts`:
- Update the auth command argument description from `'Provider (github, azure)'` to `'Provider (github, gitlab, azure)'`

**Step 4: Run the full test suite**

Run: `npm test`
Expected: All tests pass. If any tests reference the old `GitLabBackend` constructor, update them to use `create()`.

**Step 5: Run build and lint**

Run: `npm run build && npm run lint && npm run format:check`
Expected: All pass

**Step 6: Commit**

```bash
git add src/backends/factory.ts src/stores/backendDataStore.ts src/cli/commands/auth.ts src/cli/index.ts
git commit -m "feat(gitlab): integrate API backend with factory, store auth, and CLI"
```

---

## Task 7: Final Verification

**Step 1: Run the full test suite**

Run: `npm test`
Expected: All tests pass

**Step 2: Run build, lint, and format check**

Run: `npm run build && npm run lint && npm run format:check`
Expected: All pass

**Step 3: Verify no stale references to glab**

Run: `grep -r "glab" src/` — should only find references in comments/docs, not imports or function calls. Specifically:
- No `import` from `./glab.js`
- No `glabSync`, `glabExec`, `glab(` function calls
- No `glab auth status` strings

**Step 4: Review the complete diff**

Run: `git diff main --stat` — verify:
- `glab.ts` and `glab.test.ts` are deleted
- `group.ts` / `group.test.ts` are deleted (replaced by `remote.ts` / `remote.test.ts`)
- New files: `auth/gitlab.ts`, `auth/gitlab.test.ts`, `backends/gitlab/api.ts`, `backends/gitlab/api.test.ts`
- Modified: `factory.ts`, `backendDataStore.ts`, `cli/commands/auth.ts`, `cli/index.ts`
- Rewritten: `index.ts`, `mappers.ts`, `mappers.test.ts`, `gitlab.test.ts`
