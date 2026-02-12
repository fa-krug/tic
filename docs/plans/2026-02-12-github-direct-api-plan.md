# GitHub Direct API + OAuth Migration — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the `gh` CLI dependency in the GitHub backend with direct `fetch` calls and an integrated OAuth device flow, using `@napi-rs/keyring` for token storage and the `open` package for browser launching.

**Architecture:** New `src/auth/` module handles keychain storage and the GitHub device flow. New `BaseApiClient` abstract class in `src/backends/shared/` provides shared HTTP logic (retry, rate-limit). `GitHubApiClient` extends it with GitHub-specific REST/GraphQL/pagination. `GitHubBackend` switches from `gh.ts` to the new API client. A `tic auth` CLI command enables standalone authentication.

**Tech Stack:** Node built-in `fetch`, `@napi-rs/keyring`, `open` (npm package), TypeScript, Vitest

**Design doc:** `docs/plans/2026-02-12-direct-api-oauth-design.md`

---

### Task 1: Install dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install @napi-rs/keyring and open**

Run:
```bash
npm install @napi-rs/keyring open
```

**Step 2: Verify install succeeded**

Run:
```bash
npm ls @napi-rs/keyring open
```
Expected: Both packages listed without errors.

**Step 3: Verify build still works**

Run:
```bash
npm run build
```
Expected: No errors.

**Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @napi-rs/keyring and open dependencies"
```

---

### Task 2: Keychain wrapper (`src/auth/keychain.ts`)

**Files:**
- Create: `src/auth/keychain.ts`
- Create: `src/auth/keychain.test.ts`

**Step 1: Write the failing test**

Create `src/auth/keychain.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@napi-rs/keyring', () => {
  const store = new Map<string, string>();
  return {
    Entry: vi.fn().mockImplementation((service: string, account: string) => {
      const key = `${service}:${account}`;
      return {
        getPassword: () => {
          const val = store.get(key);
          if (!val) throw new Error('No password found');
          return val;
        },
        setPassword: (password: string) => {
          store.set(key, password);
        },
        deletePassword: () => {
          store.delete(key);
        },
      };
    }),
    // Expose store for test cleanup
    _store: store,
  };
});

// Must import AFTER mock
import { getToken, setToken, deleteToken } from './keychain.js';
import { _store } from '@napi-rs/keyring';

describe('keychain', () => {
  beforeEach(() => {
    ((_store as unknown) as Map<string, string>).clear();
  });

  it('returns null when no token is stored', () => {
    expect(getToken('github.com')).toBeNull();
  });

  it('stores and retrieves a token', () => {
    setToken('github.com', 'ghp_abc123');
    expect(getToken('github.com')).toBe('ghp_abc123');
  });

  it('deletes a stored token', () => {
    setToken('github.com', 'ghp_abc123');
    deleteToken('github.com');
    expect(getToken('github.com')).toBeNull();
  });

  it('uses "tic" as the service name', () => {
    const { Entry } = require('@napi-rs/keyring');
    setToken('github.com', 'token');
    expect(Entry).toHaveBeenCalledWith('tic', 'github.com');
  });

  it('handles different accounts independently', () => {
    setToken('github.com', 'gh-token');
    setToken('gitlab.com', 'gl-token');
    expect(getToken('github.com')).toBe('gh-token');
    expect(getToken('gitlab.com')).toBe('gl-token');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/auth/keychain.test.ts`
Expected: FAIL — module `./keychain.js` not found.

**Step 3: Write minimal implementation**

Create `src/auth/keychain.ts`:

```typescript
import { Entry } from '@napi-rs/keyring';

const SERVICE = 'tic';

export function getToken(account: string): string | null {
  try {
    const entry = new Entry(SERVICE, account);
    return entry.getPassword();
  } catch {
    return null;
  }
}

export function setToken(account: string, token: string): void {
  const entry = new Entry(SERVICE, account);
  entry.setPassword(token);
}

export function deleteToken(account: string): void {
  try {
    const entry = new Entry(SERVICE, account);
    entry.deletePassword();
  } catch {
    // Token may not exist — ignore
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/auth/keychain.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/auth/keychain.ts src/auth/keychain.test.ts
git commit -m "feat(auth): add keychain wrapper using @napi-rs/keyring"
```

---

### Task 3: GitHub device flow (`src/auth/github.ts`)

**Files:**
- Create: `src/auth/github.ts`
- Create: `src/auth/github.test.ts`
- Create: `src/auth/index.ts`

**Step 1: Write the failing test**

Create `src/auth/github.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./keychain.js', () => ({
  getToken: vi.fn(),
  setToken: vi.fn(),
  deleteToken: vi.fn(),
}));

import { getToken, setToken, deleteToken } from './keychain.js';
import {
  getGitHubToken,
  clearGitHubToken,
  authenticateGitHub,
  GITHUB_ACCOUNT,
  DEFAULT_CLIENT_ID,
} from './github.js';

const mockGetToken = vi.mocked(getToken);
const mockSetToken = vi.mocked(setToken);
const mockDeleteToken = vi.mocked(deleteToken);

describe('getGitHubToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns token from keychain when available', () => {
    mockGetToken.mockReturnValue('ghp_stored');
    expect(getGitHubToken()).toBe('ghp_stored');
    expect(mockGetToken).toHaveBeenCalledWith(GITHUB_ACCOUNT);
  });

  it('returns null when no token stored', () => {
    mockGetToken.mockReturnValue(null);
    expect(getGitHubToken()).toBeNull();
  });
});

describe('clearGitHubToken', () => {
  it('deletes the token from keychain', () => {
    clearGitHubToken();
    expect(mockDeleteToken).toHaveBeenCalledWith(GITHUB_ACCOUNT);
  });
});

describe('authenticateGitHub', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs the device flow and returns a token', async () => {
    // Step 1: Request device code
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        device_code: 'dc_123',
        user_code: 'ABCD-1234',
        verification_uri: 'https://github.com/login/device',
        interval: 1,
        expires_in: 900,
      }),
    });

    // Step 2: Poll — first pending, then success
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ error: 'authorization_pending' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'ghp_newtoken',
          token_type: 'bearer',
        }),
      });

    const onCode = vi.fn();
    const promise = authenticateGitHub({ onCode });

    // Advance past first poll interval
    await vi.advanceTimersByTimeAsync(1000);
    // Advance past second poll interval
    await vi.advanceTimersByTimeAsync(1000);

    const token = await promise;

    expect(token).toBe('ghp_newtoken');
    expect(onCode).toHaveBeenCalledWith('ABCD-1234', 'https://github.com/login/device');
    expect(mockSetToken).toHaveBeenCalledWith(GITHUB_ACCOUNT, 'ghp_newtoken');
  });

  it('uses custom client ID when provided', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        device_code: 'dc_123',
        user_code: 'ABCD-1234',
        verification_uri: 'https://github.com/login/device',
        interval: 1,
        expires_in: 900,
      }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'ghp_custom',
        token_type: 'bearer',
      }),
    });

    const promise = authenticateGitHub({ clientId: 'custom_id' });
    await vi.advanceTimersByTimeAsync(1000);
    await promise;

    // Verify the device code request used the custom client ID
    const firstCallBody = fetchMock.mock.calls[0][1].body;
    expect(firstCallBody).toContain('custom_id');
  });

  it('throws on access_denied', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        device_code: 'dc_123',
        user_code: 'ABCD-1234',
        verification_uri: 'https://github.com/login/device',
        interval: 1,
        expires_in: 900,
      }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ error: 'access_denied' }),
    });

    const promise = authenticateGitHub();
    await vi.advanceTimersByTimeAsync(1000);

    await expect(promise).rejects.toThrow('access_denied');
  });

  it('throws on expired_token', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        device_code: 'dc_123',
        user_code: 'ABCD-1234',
        verification_uri: 'https://github.com/login/device',
        interval: 1,
        expires_in: 900,
      }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ error: 'expired_token' }),
    });

    const promise = authenticateGitHub();
    await vi.advanceTimersByTimeAsync(1000);

    await expect(promise).rejects.toThrow('expired_token');
  });

  it('respects slow_down by increasing interval', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        device_code: 'dc_123',
        user_code: 'ABCD-1234',
        verification_uri: 'https://github.com/login/device',
        interval: 1,
        expires_in: 900,
      }),
    });
    // slow_down response
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ error: 'slow_down' }),
    });
    // success after extended interval
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'ghp_slow',
        token_type: 'bearer',
      }),
    });

    const promise = authenticateGitHub();
    // First poll at 1s
    await vi.advanceTimersByTimeAsync(1000);
    // slow_down adds 5s, so next poll at 6s
    await vi.advanceTimersByTimeAsync(6000);
    const token = await promise;
    expect(token).toBe('ghp_slow');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/auth/github.test.ts`
Expected: FAIL — module `./github.js` not found.

**Step 3: Write implementation**

Create `src/auth/github.ts`:

```typescript
import { getToken, setToken, deleteToken } from './keychain.js';

export const GITHUB_ACCOUNT = 'github.com';
export const DEFAULT_CLIENT_ID = 'YOUR_CLIENT_ID'; // TODO: Register OAuth App and replace

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  interval: number;
  expires_in: number;
}

interface TokenPollResponse {
  access_token?: string;
  token_type?: string;
  error?: string;
}

export interface AuthenticateOptions {
  clientId?: string;
  onCode?: (userCode: string, verificationUri: string) => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getGitHubToken(): string | null {
  return getToken(GITHUB_ACCOUNT);
}

export function clearGitHubToken(): void {
  deleteToken(GITHUB_ACCOUNT);
}

export async function authenticateGitHub(
  options?: AuthenticateOptions,
): Promise<string> {
  const clientId = options?.clientId ?? DEFAULT_CLIENT_ID;

  // Step 1: Request device code
  const codeResponse = await fetch(
    'https://github.com/login/device/code',
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `client_id=${clientId}&scope=repo`,
    },
  );
  if (!codeResponse.ok) {
    throw new Error(
      `Failed to request device code: ${codeResponse.status} ${codeResponse.statusText}`,
    );
  }
  const deviceCode = (await codeResponse.json()) as DeviceCodeResponse;

  // Notify caller of the user code
  options?.onCode?.(deviceCode.user_code, deviceCode.verification_uri);

  // Step 2: Poll for token
  let interval = deviceCode.interval * 1000;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    await sleep(interval);

    const tokenResponse = await fetch(
      'https://github.com/login/oauth/access_token',
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `client_id=${clientId}&device_code=${deviceCode.device_code}&grant_type=urn:ietf:params:oauth:grant-type:device_code`,
      },
    );

    const poll = (await tokenResponse.json()) as TokenPollResponse;

    if (poll.access_token) {
      setToken(GITHUB_ACCOUNT, poll.access_token);
      return poll.access_token;
    }

    if (poll.error === 'authorization_pending') {
      continue;
    }

    if (poll.error === 'slow_down') {
      interval += 5000;
      continue;
    }

    // access_denied, expired_token, or other terminal error
    throw new Error(poll.error ?? 'Unknown error during authentication');
  }
}
```

Create `src/auth/index.ts`:

```typescript
export { getToken, setToken, deleteToken } from './keychain.js';
export {
  getGitHubToken,
  clearGitHubToken,
  authenticateGitHub,
} from './github.js';
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/auth/github.test.ts`
Expected: PASS

**Step 5: Run keychain tests too**

Run: `npx vitest run src/auth/`
Expected: All PASS

**Step 6: Commit**

```bash
git add src/auth/
git commit -m "feat(auth): add GitHub OAuth device flow with keychain storage"
```

---

### Task 4: BaseApiClient (`src/backends/shared/api-client.ts`)

**Files:**
- Create: `src/backends/shared/api-client.ts`
- Create: `src/backends/shared/api-client.test.ts`

**Step 1: Write the failing test**

Create `src/backends/shared/api-client.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We'll create a concrete subclass for testing
class TestApiClient extends BaseApiClient {
  // Expose protected methods for testing
  public async testFetch<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    return this.fetch(method, path, body);
  }

  public async testRetry<T>(fn: () => Promise<T>): Promise<T> {
    return this.retry(fn);
  }

  // Simple paginate implementation for testing
  async *paginate<T>(path: string): AsyncGenerator<T[]> {
    const data = await this.fetch<T[]>('GET', path);
    yield data;
  }
}

// Must import after class definition references are resolved
import { BaseApiClient, AuthError, RateLimitError } from './api-client.js';

describe('BaseApiClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let client: TestApiClient;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock;
    client = new TestApiClient('test-token', 'https://api.example.com');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetch', () => {
    it('makes a request with auth header and returns JSON', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ id: 1, name: 'test' }),
      });

      const result = await client.testFetch<{ id: number; name: string }>(
        'GET',
        '/items',
      );

      expect(result).toEqual({ id: 1, name: 'test' });
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.example.com/items',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        }),
      );
    });

    it('sends JSON body for POST/PATCH/PUT', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({}),
      });

      await client.testFetch('POST', '/items', { title: 'New item' });

      const callArgs = fetchMock.mock.calls[0][1];
      expect(callArgs.body).toBe('{"title":"New item"}');
      expect(callArgs.headers['Content-Type']).toBe('application/json');
    });

    it('throws AuthError on 401', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 401,
        headers: new Headers(),
        text: async () => 'Unauthorized',
      });

      await expect(client.testFetch('GET', '/items')).rejects.toThrow(
        AuthError,
      );
    });

    it('throws RateLimitError on 403 with rate limit headers', async () => {
      const resetTime = Math.floor(Date.now() / 1000) + 60;
      fetchMock.mockResolvedValue({
        ok: false,
        status: 403,
        headers: new Headers({
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(resetTime),
        }),
        text: async () => 'rate limit exceeded',
      });

      await expect(client.testFetch('GET', '/items')).rejects.toThrow(
        RateLimitError,
      );
    });

    it('throws generic error on other failures', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        headers: new Headers(),
        text: async () => 'Internal Server Error',
      });

      await expect(client.testFetch('GET', '/items')).rejects.toThrow(
        'HTTP 500',
      );
    });
  });

  describe('retry', () => {
    it('retries once on 5xx and succeeds', async () => {
      let callCount = 0;
      const fn = async () => {
        callCount++;
        if (callCount === 1) throw new Error('HTTP 500');
        return 'success';
      };

      const result = await client.testRetry(fn);
      expect(result).toBe('success');
      expect(callCount).toBe(2);
    });

    it('throws after retry on 5xx', async () => {
      const fn = async () => {
        throw new Error('HTTP 500');
      };

      await expect(client.testRetry(fn)).rejects.toThrow('HTTP 500');
    });

    it('does not retry on non-5xx errors', async () => {
      let callCount = 0;
      const fn = async () => {
        callCount++;
        throw new AuthError('Unauthorized');
      };

      await expect(client.testRetry(fn)).rejects.toThrow(AuthError);
      expect(callCount).toBe(1);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/backends/shared/api-client.test.ts`
Expected: FAIL — module not found.

**Step 3: Write implementation**

Create `src/backends/shared/api-client.ts`:

```typescript
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export class RateLimitError extends Error {
  constructor(
    message: string,
    public resetAt: Date,
  ) {
    super(message);
    this.name = 'RateLimitError';
  }
}

export abstract class BaseApiClient {
  constructor(
    protected token: string,
    protected baseUrl: string,
  ) {}

  protected async fetch<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/json',
    };

    const init: RequestInit = { method, headers };

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    const response = await fetch(url, init);

    this.checkRateLimit(response.headers);

    if (!response.ok) {
      if (response.status === 401) {
        throw new AuthError('Authentication failed — token may be invalid or expired');
      }

      if (response.status === 403) {
        const remaining = response.headers.get('X-RateLimit-Remaining');
        const reset = response.headers.get('X-RateLimit-Reset');
        if (remaining === '0' && reset) {
          const resetAt = new Date(Number(reset) * 1000);
          throw new RateLimitError(
            `Rate limit exceeded. Resets at ${resetAt.toISOString()}`,
            resetAt,
          );
        }
      }

      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text}`);
    }

    return (await response.json()) as T;
  }

  protected checkRateLimit(headers: Headers): void {
    const remaining = headers.get('X-RateLimit-Remaining');
    if (remaining !== null && Number(remaining) < 100) {
      // Log warning — subclasses can override for custom behavior
      console.warn(`GitHub API rate limit low: ${remaining} requests remaining`);
    }
  }

  protected async retry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      // Only retry on 5xx errors
      if (
        err instanceof Error &&
        err.message.startsWith('HTTP 5') &&
        !(err instanceof AuthError) &&
        !(err instanceof RateLimitError)
      ) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return fn();
      }
      throw err;
    }
  }

  abstract paginate<T>(path: string): AsyncGenerator<T[]>;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/backends/shared/api-client.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/backends/shared/
git commit -m "feat(api): add BaseApiClient with shared fetch, retry, and rate-limit logic"
```

---

### Task 5: GitHubApiClient (`src/backends/github/api.ts`)

**Files:**
- Create: `src/backends/github/api.ts`
- Create: `src/backends/github/api.test.ts`

**Step 1: Write the failing test**

Create `src/backends/github/api.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GitHubApiClient } from './api.js';
import { AuthError } from '../shared/api-client.js';

describe('GitHubApiClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let client: GitHubApiClient;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock;
    client = new GitHubApiClient('ghp_test123');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('rest', () => {
    it('sends GitHub-specific headers', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ([]),
      });

      await client.rest('GET', '/repos/owner/repo/issues');

      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.github.com/repos/owner/repo/issues');
      expect(opts.headers['X-GitHub-Api-Version']).toBe('2022-11-28');
      expect(opts.headers['Authorization']).toBe('Bearer ghp_test123');
    });

    it('sends JSON body on POST', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 201,
        headers: new Headers(),
        json: async () => ({ number: 10 }),
      });

      const result = await client.rest('POST', '/repos/owner/repo/issues', {
        title: 'New issue',
      });
      expect(result).toEqual({ number: 10 });
    });

    it('throws AuthError on 401', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 401,
        headers: new Headers(),
        text: async () => 'Bad credentials',
      });

      await expect(
        client.rest('GET', '/repos/owner/repo/issues'),
      ).rejects.toThrow(AuthError);
    });
  });

  describe('graphql', () => {
    it('sends query to GraphQL endpoint with sub_issues header', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          data: { repository: { issue: { title: 'Test' } } },
        }),
      });

      const result = await client.graphql<{
        repository: { issue: { title: string } };
      }>('query { repository { issue { title } } }');

      expect(result).toEqual({
        repository: { issue: { title: 'Test' } },
      });

      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.github.com/graphql');
      expect(opts.headers['GraphQL-Features']).toBe('sub_issues');
      expect(JSON.parse(opts.body)).toEqual({
        query: 'query { repository { issue { title } } }',
      });
    });

    it('passes variables to GraphQL', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ data: {} }),
      });

      await client.graphql('query($owner: String!) { }', { owner: 'test' });

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.variables).toEqual({ owner: 'test' });
    });

    it('throws on GraphQL errors', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          errors: [{ message: 'Not found' }],
        }),
      });

      await expect(client.graphql('query { bad }')).rejects.toThrow(
        'GraphQL error: Not found',
      );
    });
  });

  describe('paginate', () => {
    it('follows Link header pagination', async () => {
      // Page 1 — has next page
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          Link: '<https://api.github.com/repos/owner/repo/issues?page=2>; rel="next"',
        }),
        json: async () => [{ number: 1 }, { number: 2 }],
      });
      // Page 2 — no next
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => [{ number: 3 }],
      });

      const pages: unknown[][] = [];
      for await (const page of client.paginate('/repos/owner/repo/issues')) {
        pages.push(page);
      }

      expect(pages).toHaveLength(2);
      expect(pages[0]).toHaveLength(2);
      expect(pages[1]).toHaveLength(1);
    });

    it('yields single page when no Link header', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => [{ number: 1 }],
      });

      const pages: unknown[][] = [];
      for await (const page of client.paginate('/repos/owner/repo/issues')) {
        pages.push(page);
      }

      expect(pages).toHaveLength(1);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/backends/github/api.test.ts`
Expected: FAIL — module `./api.js` not found.

**Step 3: Write implementation**

Create `src/backends/github/api.ts`:

```typescript
import { BaseApiClient, AuthError } from '../shared/api-client.js';

const GITHUB_API = 'https://api.github.com';

export class GitHubApiClient extends BaseApiClient {
  constructor(token: string) {
    super(token, GITHUB_API);
  }

  async rest<T>(method: string, path: string, body?: unknown): Promise<T> {
    return this.retry(() => this.fetch(method, path, body));
  }

  async graphql<T>(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<T> {
    const url = `${this.baseUrl}/graphql`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
      'GraphQL-Features': 'sub_issues',
    };

    const reqBody: Record<string, unknown> = { query };
    if (variables) reqBody.variables = variables;

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(reqBody),
    });

    this.checkRateLimit(response.headers);

    if (!response.ok) {
      if (response.status === 401) {
        throw new AuthError(
          'Authentication failed — token may be invalid or expired',
        );
      }
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text}`);
    }

    const json = (await response.json()) as {
      data?: T;
      errors?: { message: string }[];
    };

    if (json.errors?.length) {
      throw new Error(`GraphQL error: ${json.errors[0]!.message}`);
    }

    return json.data as T;
  }

  async *paginate<T>(path: string): AsyncGenerator<T[]> {
    let url: string | null = `${this.baseUrl}${path}`;

    while (url) {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });

      this.checkRateLimit(response.headers);

      if (!response.ok) {
        if (response.status === 401) {
          throw new AuthError(
            'Authentication failed — token may be invalid or expired',
          );
        }
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text}`);
      }

      const data = (await response.json()) as T[];
      yield data;

      // Parse Link header for next page
      const link = response.headers.get('Link');
      url = null;
      if (link) {
        const match = link.match(/<([^>]+)>;\s*rel="next"/);
        if (match) {
          url = match[1]!;
        }
      }
    }
  }

  protected override async fetch<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    };

    const init: RequestInit = { method, headers };

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    const response = await fetch(url, init);
    this.checkRateLimit(response.headers);

    if (!response.ok) {
      if (response.status === 401) {
        throw new AuthError(
          'Authentication failed — token may be invalid or expired',
        );
      }
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text}`);
    }

    return (await response.json()) as T;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/backends/github/api.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/backends/github/api.ts src/backends/github/api.test.ts
git commit -m "feat(github): add GitHubApiClient with REST, GraphQL, and pagination"
```

---

### Task 6: Migrate GitHubBackend to use GitHubApiClient

**Files:**
- Modify: `src/backends/github/index.ts`
- Modify: `src/backends/github/github.test.ts`
- Delete: `src/backends/github/gh.ts`
- Delete: `src/backends/github/gh.test.ts`

This is the core migration. The backend changes from shelling out to `gh` CLI to using `GitHubApiClient` directly.

**Step 1: Rewrite `src/backends/github/index.ts`**

Key changes:
- Replace `import { gh, ghExec, ghGraphQL, ghExecSync, ghSync } from './gh.js'` with `import { GitHubApiClient } from './api.js'`
- Add `import { getGitHubToken, authenticateGitHub } from '../../auth/github.js'`
- Add `import open from 'open'`
- Constructor becomes private, add static `async create(cwd: string)` factory
- Store `owner` and `repo` as properties (resolved during `create()`)
- `getItemUrl()` constructs URL from `owner/repo/id` — no API call
- `openItem()` uses `open` package
- `createWorkItem()` uses REST `POST /repos/{owner}/{repo}/issues`
- `updateWorkItem()` uses REST `PATCH /repos/{owner}/{repo}/issues/{number}`
- `deleteWorkItem()` uses GraphQL `deleteIssue` mutation
- `addComment()` uses REST `POST /repos/{owner}/{repo}/issues/{number}/comments`
- `getAssignees()` uses `this.api.paginate()`
- `fetchMilestones()` uses `this.api.rest()`
- `listWorkItems()` / `getWorkItem()` use `this.api.graphql()`
- `getRepoNwo()` replaced by `execSync('git remote -v')` parsing in factory (already done at backend detection time)

Full replacement for `src/backends/github/index.ts`:

```typescript
import { execSync } from 'node:child_process';
import open from 'open';
import { BaseBackend, UnsupportedOperationError } from '../types.js';
import type { BackendCapabilities } from '../types.js';
import type {
  WorkItem,
  NewWorkItem,
  NewComment,
  Comment,
  Template,
} from '../../types.js';
import { GitHubApiClient } from './api.js';
import { getGitHubToken, authenticateGitHub } from '../../auth/github.js';
import { mapIssueToWorkItem } from './mappers.js';
import type { GhIssue, GhMilestone } from './mappers.js';

const LIST_ISSUES_QUERY = `
  query($owner: String!, $repo: String!, $cursor: String) {
    repository(owner: $owner, name: $repo) {
      issues(first: 100, after: $cursor, states: [OPEN, CLOSED]) {
        nodes {
          number title body state
          assignees(first: 10) { nodes { login } }
          labels(first: 20) { nodes { name } }
          milestone { title }
          createdAt updatedAt
          comments(first: 100) { nodes { author { login } createdAt body } }
          parent { number }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

const GET_ISSUE_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      issue(number: $number) {
        number title body state
        assignees(first: 10) { nodes { login } }
        labels(first: 20) { nodes { name } }
        milestone { title }
        createdAt updatedAt
        comments(first: 100) { nodes { author { login } createdAt body } }
        parent { number }
      }
    }
  }
`;

const GET_ISSUE_NODE_ID_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      issue(number: $number) { id }
    }
  }
`;

const ADD_SUB_ISSUE_MUTATION = `
  mutation($parentId: ID!, $childId: ID!) {
    addSubIssue(input: { issueId: $parentId, subIssueId: $childId }) {
      issue { title }
      subIssue { title }
    }
  }
`;

const REMOVE_SUB_ISSUE_MUTATION = `
  mutation($parentId: ID!, $childId: ID!) {
    removeSubIssue(input: { issueId: $parentId, subIssueId: $childId }) {
      issue { title }
      subIssue { title }
    }
  }
`;

const DELETE_ISSUE_MUTATION = `
  mutation($issueId: ID!) {
    deleteIssue(input: { issueId: $issueId }) {
      repository { name }
    }
  }
`;

interface ListIssuesResponse {
  repository: {
    issues: {
      nodes: GhIssue[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  };
}

interface GetIssueResponse {
  repository: {
    issue: GhIssue;
  };
}

interface GetIssueNodeIdResponse {
  repository: {
    issue: { id: string };
  };
}

export class GitHubBackend extends BaseBackend {
  private api: GitHubApiClient;
  private owner: string;
  private repo: string;
  private cachedMilestones: GhMilestone[] | null = null;

  private constructor(api: GitHubApiClient, owner: string, repo: string) {
    super(60_000);
    this.api = api;
    this.owner = owner;
    this.repo = repo;
  }

  static async create(cwd: string): Promise<GitHubBackend> {
    let token = getGitHubToken();
    if (!token) {
      token = await authenticateGitHub({
        onCode: (code, url) => {
          console.log(`\nGitHub authentication required.`);
          console.log(`Visit ${url} and enter code: ${code}\n`);
        },
      });
    }

    const { owner, repo } = GitHubBackend.detectOwnerRepo(cwd);
    const api = new GitHubApiClient(token);
    return new GitHubBackend(api, owner, repo);
  }

  private static detectOwnerRepo(cwd: string): {
    owner: string;
    repo: string;
  } {
    const output = execSync('git remote -v', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    // Match github.com/owner/repo or github.com:owner/repo
    const match = output.match(
      /github\.com[:/]([^/\s]+)\/([^/\s.]+?)(?:\.git)?(?:\s|$)/,
    );
    if (!match) {
      throw new Error(
        'Could not detect GitHub owner/repo from git remotes',
      );
    }
    return { owner: match[1]!, repo: match[2]! };
  }

  protected override onCacheInvalidate(): void {
    this.cachedMilestones = null;
  }

  getCapabilities(): BackendCapabilities {
    return {
      relationships: true,
      customTypes: false,
      customStatuses: false,
      iterations: true,
      comments: true,
      fields: {
        priority: false,
        assignee: true,
        labels: true,
        parent: true,
        dependsOn: false,
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

  // eslint-disable-next-line @typescript-eslint/require-await
  async getStatuses(): Promise<string[]> {
    return ['open', 'closed'];
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getWorkItemTypes(): Promise<string[]> {
    return ['issue'];
  }

  async getAssignees(): Promise<string[]> {
    try {
      const all: { login: string }[] = [];
      for await (const page of this.api.paginate<{ login: string }>(
        `/repos/${this.owner}/${this.repo}/collaborators`,
      )) {
        all.push(...page);
      }
      return all.map((c) => c.login);
    } catch {
      return [];
    }
  }

  async getLabels(): Promise<string[]> {
    return this.getLabelsFromCache();
  }

  async getIterations(): Promise<string[]> {
    const milestones = await this.fetchMilestones();
    return milestones.map((m) => m.title);
  }

  async getCurrentIteration(): Promise<string> {
    const milestones = await this.fetchOpenMilestones();
    if (milestones.length === 0) return '';
    return milestones[0]!.title;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async setCurrentIteration(_name: string): Promise<void> {
    // No-op — current iteration is always first open milestone
  }

  async listWorkItems(iteration?: string): Promise<WorkItem[]> {
    const allIssues: GhIssue[] = [];
    let cursor: string | null = null;

    do {
      const data = await this.api.graphql<ListIssuesResponse>(
        LIST_ISSUES_QUERY,
        { owner: this.owner, repo: this.repo, cursor },
      );
      allIssues.push(...data.repository.issues.nodes);
      cursor = data.repository.issues.pageInfo.hasNextPage
        ? data.repository.issues.pageInfo.endCursor
        : null;
    } while (cursor !== null);

    let items = allIssues.map(mapIssueToWorkItem);
    if (iteration) {
      items = items.filter((i) => i.iteration === iteration);
    }
    return items;
  }

  async getWorkItem(id: string): Promise<WorkItem> {
    const data = await this.api.graphql<GetIssueResponse>(
      GET_ISSUE_QUERY,
      { owner: this.owner, repo: this.repo, number: Number(id) },
    );
    return mapIssueToWorkItem(data.repository.issue);
  }

  private async ensureLabels(labels: string[]): Promise<void> {
    for (const label of labels) {
      try {
        await this.api.rest('POST', `/repos/${this.owner}/${this.repo}/labels`, {
          name: label,
        });
      } catch {
        // Label already exists — ignore
      }
    }
  }

  async createWorkItem(data: NewWorkItem): Promise<WorkItem> {
    this.validateFields(data);
    if (data.labels.length > 0) {
      await this.ensureLabels(data.labels);
    }

    const body: Record<string, unknown> = {
      title: data.title,
      body: data.description || '',
    };
    if (data.assignee) {
      body.assignees = [data.assignee];
    }
    if (data.iteration) {
      // Need to find milestone number by title
      const milestones = await this.fetchMilestones();
      const ms = milestones.find((m) => m.title === data.iteration);
      if (ms) {
        body.milestone = (ms as GhMilestone & { number?: number }).number;
      }
    }
    if (data.labels.length > 0) {
      body.labels = data.labels;
    }

    const created = await this.api.rest<{ number: number }>(
      'POST',
      `/repos/${this.owner}/${this.repo}/issues`,
      body,
    );
    const id = String(created.number);

    if (data.parent) {
      try {
        await this.addSubIssue(data.parent, id);
      } catch (err) {
        try {
          await this.deleteWorkItem(id);
        } catch {
          // Best-effort cleanup
        }
        throw new Error(
          `Failed to link parent #${data.parent} to issue #${id}; issue was rolled back: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return this.getWorkItem(id);
  }

  async updateWorkItem(
    id: string,
    data: Partial<WorkItem>,
  ): Promise<WorkItem> {
    this.validateFields(data);
    if (data.labels !== undefined && data.labels.length > 0) {
      await this.ensureLabels(data.labels);
    }

    // Handle parent changes via sub-issue mutations
    if (data.parent !== undefined) {
      const current = await this.getWorkItem(id);
      try {
        if (current.parent && current.parent !== data.parent) {
          await this.removeSubIssue(current.parent, id);
        }
        if (data.parent && data.parent !== current.parent) {
          await this.addSubIssue(data.parent, id);
        }
      } catch (err) {
        throw new Error(
          `Failed to update parent relationship for issue #${id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Build PATCH body for all field updates
    const patchBody: Record<string, unknown> = {};
    let hasPatch = false;

    if (data.status !== undefined) {
      patchBody.state = data.status === 'closed' ? 'closed' : 'open';
      hasPatch = true;
    }
    if (data.title !== undefined) {
      patchBody.title = data.title;
      hasPatch = true;
    }
    if (data.description !== undefined) {
      patchBody.body = data.description;
      hasPatch = true;
    }
    if (data.iteration !== undefined) {
      if (data.iteration) {
        const milestones = await this.fetchMilestones();
        const ms = milestones.find((m) => m.title === data.iteration);
        if (ms) {
          patchBody.milestone =
            (ms as GhMilestone & { number?: number }).number;
        }
      } else {
        patchBody.milestone = null;
      }
      hasPatch = true;
    }
    if (data.assignee !== undefined) {
      patchBody.assignees = data.assignee ? [data.assignee] : [];
      hasPatch = true;
    }
    if (data.labels !== undefined) {
      patchBody.labels = data.labels;
      hasPatch = true;
    }

    if (hasPatch) {
      await this.api.rest(
        'PATCH',
        `/repos/${this.owner}/${this.repo}/issues/${id}`,
        patchBody,
      );
    }

    return this.getWorkItem(id);
  }

  async deleteWorkItem(id: string): Promise<void> {
    const nodeId = await this.getIssueNodeId(Number(id));
    await this.api.graphql(DELETE_ISSUE_MUTATION, { issueId: nodeId });
  }

  async addComment(
    workItemId: string,
    comment: NewComment,
  ): Promise<Comment> {
    await this.api.rest(
      'POST',
      `/repos/${this.owner}/${this.repo}/issues/${workItemId}/comments`,
      { body: comment.body },
    );
    return {
      author: comment.author,
      date: new Date().toISOString(),
      body: comment.body,
    };
  }

  getItemUrl(id: string): string {
    return `https://github.com/${this.owner}/${this.repo}/issues/${id}`;
  }

  async openItem(id: string): Promise<void> {
    const url = this.getItemUrl(id);
    await open(url);
  }

  /* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unused-vars */
  async listTemplates(): Promise<Template[]> {
    throw new UnsupportedOperationError('templates', 'GitHubBackend');
  }
  async getTemplate(_slug: string): Promise<Template> {
    throw new UnsupportedOperationError('templates', 'GitHubBackend');
  }
  async createTemplate(_template: Template): Promise<Template> {
    throw new UnsupportedOperationError('templates', 'GitHubBackend');
  }
  async updateTemplate(
    _oldSlug: string,
    _template: Template,
  ): Promise<Template> {
    throw new UnsupportedOperationError('templates', 'GitHubBackend');
  }
  async deleteTemplate(_slug: string): Promise<void> {
    throw new UnsupportedOperationError('templates', 'GitHubBackend');
  }
  /* eslint-enable @typescript-eslint/require-await, @typescript-eslint/no-unused-vars */

  private async getIssueNodeId(issueNumber: number): Promise<string> {
    const data = await this.api.graphql<GetIssueNodeIdResponse>(
      GET_ISSUE_NODE_ID_QUERY,
      { owner: this.owner, repo: this.repo, number: issueNumber },
    );
    return data.repository.issue.id;
  }

  private async addSubIssue(
    parentNumber: string,
    childNumber: string,
  ): Promise<void> {
    const parentId = await this.getIssueNodeId(Number(parentNumber));
    const childId = await this.getIssueNodeId(Number(childNumber));
    await this.api.graphql(ADD_SUB_ISSUE_MUTATION, { parentId, childId });
  }

  private async removeSubIssue(
    parentNumber: string,
    childNumber: string,
  ): Promise<void> {
    const parentId = await this.getIssueNodeId(Number(parentNumber));
    const childId = await this.getIssueNodeId(Number(childNumber));
    await this.api.graphql(REMOVE_SUB_ISSUE_MUTATION, { parentId, childId });
  }

  private async fetchMilestones(): Promise<GhMilestone[]> {
    if (this.cachedMilestones) return this.cachedMilestones;
    const all: GhMilestone[] = [];
    for await (const page of this.api.paginate<GhMilestone>(
      `/repos/${this.owner}/${this.repo}/milestones`,
    )) {
      all.push(...page);
    }
    this.cachedMilestones = all;
    return all;
  }

  private async fetchOpenMilestones(): Promise<GhMilestone[]> {
    const milestones = await this.fetchMilestones();
    return milestones
      .filter((m) => m.state === 'open')
      .sort((a, b) => {
        if (!a.due_on && !b.due_on) return 0;
        if (!a.due_on) return 1;
        if (!b.due_on) return -1;
        return a.due_on.localeCompare(b.due_on);
      });
  }
}
```

**Step 2: Update `GhMilestone` in `mappers.ts` to include `number` field**

Add `number` field to `GhMilestone` interface in `src/backends/github/mappers.ts:23-27`:

```typescript
export interface GhMilestone {
  number: number;
  title: string;
  state: string;
  due_on: string | null;
}
```

**Step 3: Rewrite `github.test.ts` to mock `GitHubApiClient` and auth**

Replace the mock setup at the top of `src/backends/github/github.test.ts`. The test structure and assertions stay the same, but mocks target `api.ts` and `auth/github.ts` instead of `gh.ts`.

Key changes:
- Mock `./api.js` with a mock `GitHubApiClient` class
- Mock `../../auth/github.js` with `getGitHubToken` returning a token
- Mock `open` package
- Mock `node:child_process` for `execSync` (git remote detection in `create()`)
- Change `new GitHubBackend('/repo')` to `await GitHubBackend.create('/repo')` everywhere
- Replace `mockGh`, `mockGhExec`, `mockGhGraphQL` with `mockApi.rest`, `mockApi.graphql`, `mockApi.paginate`

**Step 4: Delete `src/backends/github/gh.ts` and `src/backends/github/gh.test.ts`**

**Step 5: Run tests**

Run: `npx vitest run src/backends/github/`
Expected: All PASS

**Step 6: Commit**

```bash
git add src/backends/github/ src/auth/
git rm src/backends/github/gh.ts src/backends/github/gh.test.ts
git commit -m "feat(github)!: replace gh CLI with direct API calls and OAuth device flow"
```

---

### Task 7: Update factory and backendDataStore

**Files:**
- Modify: `src/backends/factory.ts:60-63`
- Modify: `src/stores/backendDataStore.ts:85-86` (indirectly via `createRemoteBackend`)

**Step 1: Update factory.ts**

In `src/backends/factory.ts`, change the GitHub case (lines 60-63) from:

```typescript
case 'github': {
  const { GitHubBackend } = await import('./github/index.js');
  return new GitHubBackend(root);
}
```

To:

```typescript
case 'github': {
  const { GitHubBackend } = await import('./github/index.js');
  return GitHubBackend.create(root);
}
```

This is a one-line change. `backendDataStore.ts` already calls `createRemoteBackend()` which calls this, so no changes needed there.

**Step 2: Verify build**

Run: `npm run build`
Expected: No errors.

**Step 3: Run full test suite**

Run: `npm test`
Expected: All tests pass.

**Step 4: Commit**

```bash
git add src/backends/factory.ts
git commit -m "refactor(factory): use async GitHubBackend.create() factory"
```

---

### Task 8: Add `tic auth` CLI command

**Files:**
- Create: `src/cli/commands/auth.ts`
- Modify: `src/cli/index.ts`

**Step 1: Create `src/cli/commands/auth.ts`**

```typescript
import {
  getGitHubToken,
  authenticateGitHub,
  clearGitHubToken,
  GITHUB_ACCOUNT,
} from '../../auth/github.js';
import { getToken } from '../../auth/keychain.js';

type AuthProvider = 'github';

const VALID_PROVIDERS: AuthProvider[] = ['github'];

export async function runAuthLogin(provider: string): Promise<string> {
  if (!VALID_PROVIDERS.includes(provider as AuthProvider)) {
    throw new Error(
      `Unknown provider "${provider}". Valid: ${VALID_PROVIDERS.join(', ')}`,
    );
  }

  switch (provider) {
    case 'github': {
      const token = await authenticateGitHub({
        onCode: (code, url) => {
          console.log(`\nVisit ${url}`);
          console.log(`Enter code: ${code}\n`);
          console.log('Waiting for authorization...');
        },
      });
      return token;
    }
    default:
      throw new Error(`Provider "${provider}" not yet implemented`);
  }
}

export function runAuthStatus(): { provider: string; authenticated: boolean }[] {
  return [
    {
      provider: 'github',
      authenticated: getToken(GITHUB_ACCOUNT) !== null,
    },
  ];
}

export function runAuthLogout(provider: string): void {
  if (!VALID_PROVIDERS.includes(provider as AuthProvider)) {
    throw new Error(
      `Unknown provider "${provider}". Valid: ${VALID_PROVIDERS.join(', ')}`,
    );
  }

  switch (provider) {
    case 'github':
      clearGitHubToken();
      break;
  }
}
```

**Step 2: Register commands in `src/cli/index.ts`**

Add after the `mcp` command block (around line 525), before `// Global options`:

```typescript
// tic auth ...
const auth = program.command('auth').description('Manage authentication');

auth
  .command('login')
  .description('Authenticate with a backend provider')
  .argument('<provider>', 'Provider (github)')
  .action(async (provider: string) => {
    const parentOpts = program.opts<GlobalOpts>();
    try {
      const { runAuthLogin } = await import('./commands/auth.js');
      await runAuthLogin(provider);
      if (!parentOpts.quiet) {
        console.log(`Authenticated with ${provider}`);
      }
    } catch (err) {
      handleError(err, parentOpts.json);
    }
  });

auth
  .command('status')
  .description('Show authentication status for all providers')
  .action(async () => {
    const parentOpts = program.opts<GlobalOpts>();
    try {
      const { runAuthStatus } = await import('./commands/auth.js');
      const results = runAuthStatus();
      if (parentOpts.json) {
        console.log(formatJson(results));
      } else {
        for (const r of results) {
          const icon = r.authenticated ? '✓' : '✗';
          console.log(`${icon}\t${r.provider}`);
        }
      }
    } catch (err) {
      handleError(err, parentOpts.json);
    }
  });

auth
  .command('logout')
  .description('Remove stored credentials for a provider')
  .argument('<provider>', 'Provider (github)')
  .action(async (provider: string) => {
    const parentOpts = program.opts<GlobalOpts>();
    try {
      const { runAuthLogout } = await import('./commands/auth.js');
      runAuthLogout(provider);
      if (!parentOpts.quiet) {
        console.log(`Logged out of ${provider}`);
      }
    } catch (err) {
      handleError(err, parentOpts.json);
    }
  });
```

**Step 3: Verify build**

Run: `npm run build`
Expected: No errors.

**Step 4: Commit**

```bash
git add src/cli/commands/auth.ts src/cli/index.ts
git commit -m "feat(cli): add tic auth login/status/logout commands"
```

---

### Task 9: Handle auth in MCP context

**Files:**
- Modify: `src/cli/commands/mcp.ts` (or wherever MCP tools create backends)

The MCP server creates backends via `createBackendWithSync()` in `factory.ts`. With the new async `GitHubBackend.create()`, the device flow will automatically trigger when no token is found.

**Step 1: Read the MCP server implementation**

Read `src/cli/commands/mcp.ts` to understand how backends are created and tools are dispatched.

**Step 2: Add auth-aware error handling**

When `GitHubBackend.create()` is called from the MCP context and no token is stored, it needs to:
1. Start the device flow
2. Return the code/URL as part of the tool response text
3. Block until auth completes
4. Continue with the original operation

This is handled naturally because `GitHubBackend.create()` calls `authenticateGitHub()` with an `onCode` callback. In MCP context, the callback should collect the code/URL text. The tool response will include it since `authenticateGitHub` blocks until the flow completes.

The simplest approach: wrap `createBackendWithSync()` calls in MCP tools to catch `AuthError` and return a descriptive text response, or let the device flow block with a console log that the MCP client can surface.

**Implementation details will depend on the current MCP code structure.** Read the file first, then adapt.

**Step 3: Run full test suite**

Run: `npm test`
Expected: All tests pass.

**Step 4: Commit**

```bash
git add src/cli/commands/mcp.ts
git commit -m "feat(mcp): handle GitHub auth flow in MCP tool responses"
```

---

### Task 10: Final verification and cleanup

**Step 1: Run format**

Run: `npm run format`

**Step 2: Run lint**

Run: `npm run lint`

**Step 3: Run type check**

Run: `npx tsc --noEmit`

**Step 4: Run full test suite**

Run: `npm test`
Expected: All tests pass.

**Step 5: Verify build**

Run: `npm run build`

**Step 6: Verify the gh CLI is no longer referenced anywhere**

Run: `grep -r "from './gh" src/backends/github/` — should return nothing.
Run: `grep -r "'gh'" src/backends/github/` — should return nothing.
Run: `grep -r "execFileSync.*'gh'" src/` — should return nothing.

**Step 7: Commit any remaining changes**

```bash
git add -A
git commit -m "chore: final cleanup for GitHub direct API migration"
```

---

## Summary of File Changes

**Created:**
- `src/auth/keychain.ts` — Keychain wrapper
- `src/auth/keychain.test.ts` — Tests
- `src/auth/github.ts` — Device flow
- `src/auth/github.test.ts` — Tests
- `src/auth/index.ts` — Re-exports
- `src/backends/shared/api-client.ts` — BaseApiClient
- `src/backends/shared/api-client.test.ts` — Tests
- `src/backends/github/api.ts` — GitHubApiClient
- `src/backends/github/api.test.ts` — Tests
- `src/cli/commands/auth.ts` — Auth CLI commands

**Modified:**
- `package.json` — Add `@napi-rs/keyring`, `open`
- `src/backends/github/index.ts` — Full rewrite (gh CLI → direct API)
- `src/backends/github/github.test.ts` — Updated mocks
- `src/backends/github/mappers.ts` — Add `number` to `GhMilestone`
- `src/backends/factory.ts` — `GitHubBackend.create()` instead of `new GitHubBackend()`
- `src/cli/index.ts` — Register `tic auth` commands
- `src/cli/commands/mcp.ts` — Auth-aware error handling

**Deleted:**
- `src/backends/github/gh.ts`
- `src/backends/github/gh.test.ts`
