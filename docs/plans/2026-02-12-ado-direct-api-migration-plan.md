# ADO Direct API Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate the Azure DevOps backend from `az` CLI to direct HTTP API calls with Entra ID device code flow + PAT fallback auth.

**Architecture:** `AdoApiClient` extends `BaseApiClient` (shared with GitHub). Auth via Azure CLI's well-known client ID for device code flow, with PAT fallback for locked-down tenants. Same WIQL query patterns, just over HTTP instead of CLI.

**Tech Stack:** TypeScript, Node `fetch`, Entra ID OAuth2 device code flow, `@napi-rs/keyring` for token storage.

**Working directory:** `/Users/skrug/PycharmProjects/tic/.worktrees/ado-direct-api`

---

## Task 1: ADO Auth Module

**Files:**
- Create: `src/auth/ado.ts`
- Test: `src/auth/ado.test.ts`

**Step 1: Write the test file**

Create `src/auth/ado.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockGetToken, mockSetToken, mockDeleteToken } = vi.hoisted(() => {
  return {
    mockGetToken: vi.fn(),
    mockSetToken: vi.fn(),
    mockDeleteToken: vi.fn(),
  };
});

vi.mock('./keychain.js', () => ({
  getToken: mockGetToken,
  setToken: mockSetToken,
  deleteToken: mockDeleteToken,
}));

import {
  getAdoToken,
  getAdoRefreshToken,
  getAdoPat,
  clearAdoTokens,
  authenticateAdo,
  ADO_ACCOUNT,
  ADO_REFRESH_ACCOUNT,
  ADO_PAT_ACCOUNT,
  AZURE_CLI_CLIENT_ID,
} from './ado.js';

describe('ado auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constants', () => {
    it('exports the correct account names', () => {
      expect(ADO_ACCOUNT).toBe('dev.azure.com');
      expect(ADO_REFRESH_ACCOUNT).toBe('dev.azure.com:refresh');
      expect(ADO_PAT_ACCOUNT).toBe('dev.azure.com:pat');
    });

    it('exports the Azure CLI client ID', () => {
      expect(AZURE_CLI_CLIENT_ID).toBe(
        '04b07795-8ddb-461a-bbee-02f9e1bf7b46',
      );
    });
  });

  describe('getAdoToken', () => {
    it('returns stored token from keychain', () => {
      mockGetToken.mockReturnValue('eyJ...');
      const result = getAdoToken();
      expect(mockGetToken).toHaveBeenCalledWith('dev.azure.com');
      expect(result).toBe('eyJ...');
    });

    it('returns null when no token is stored', () => {
      mockGetToken.mockReturnValue(null);
      const result = getAdoToken();
      expect(result).toBeNull();
    });
  });

  describe('getAdoRefreshToken', () => {
    it('returns stored refresh token', () => {
      mockGetToken.mockReturnValue('refresh_token_abc');
      const result = getAdoRefreshToken();
      expect(mockGetToken).toHaveBeenCalledWith('dev.azure.com:refresh');
      expect(result).toBe('refresh_token_abc');
    });
  });

  describe('getAdoPat', () => {
    it('returns stored PAT', () => {
      mockGetToken.mockReturnValue('pat_abc');
      const result = getAdoPat();
      expect(mockGetToken).toHaveBeenCalledWith('dev.azure.com:pat');
      expect(result).toBe('pat_abc');
    });
  });

  describe('clearAdoTokens', () => {
    it('deletes all ADO keychain entries', () => {
      clearAdoTokens();
      expect(mockDeleteToken).toHaveBeenCalledWith('dev.azure.com');
      expect(mockDeleteToken).toHaveBeenCalledWith('dev.azure.com:refresh');
      expect(mockDeleteToken).toHaveBeenCalledWith('dev.azure.com:pat');
    });
  });

  describe('authenticateAdo', () => {
    const mockDeviceCodeResponse = {
      device_code: 'dc_test123',
      user_code: 'ABCD1234',
      verification_uri: 'https://microsoft.com/devicelogin',
      expires_in: 900,
      interval: 5,
      message: 'To sign in, use a web browser to open the page https://microsoft.com/devicelogin and enter the code ABCD1234 to authenticate.',
    };

    const mockTokenSuccess = {
      access_token: 'eyJ_access',
      refresh_token: 'eyJ_refresh',
      token_type: 'Bearer',
      expires_in: 3600,
      scope: '499b84ac-1321-427f-aa17-267ca6975798/.default',
    };

    function mockFetchResponses(
      ...responses: Array<{ ok?: boolean; status?: number; json: unknown }>
    ) {
      const fetchMock = vi.fn();
      for (const resp of responses) {
        fetchMock.mockResolvedValueOnce({
          ok: resp.ok ?? true,
          status: resp.status ?? 200,
          statusText: 'OK',
          json: () => Promise.resolve(resp.json),
        });
      }
      vi.stubGlobal('fetch', fetchMock);
      return fetchMock;
    }

    it('completes the full device flow successfully', async () => {
      const fetchMock = mockFetchResponses(
        { json: mockDeviceCodeResponse },
        { json: { error: 'authorization_pending' } },
        { json: mockTokenSuccess },
      );

      const promise = authenticateAdo();

      await vi.advanceTimersByTimeAsync(5000);
      await vi.advanceTimersByTimeAsync(5000);

      const token = await promise;

      expect(token).toBe('eyJ_access');
      expect(fetchMock).toHaveBeenCalledTimes(3);

      // Verify device code request
      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        'https://login.microsoftonline.com/organizations/oauth2/v2.0/devicecode',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        }),
      );

      // Verify token poll request
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        'https://login.microsoftonline.com/organizations/oauth2/v2.0/token',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        }),
      );
    });

    it('calls onCode callback with user code and verification URI', async () => {
      mockFetchResponses(
        { json: mockDeviceCodeResponse },
        { json: mockTokenSuccess },
      );

      const onCode = vi.fn();
      const promise = authenticateAdo({ onCode });
      await vi.advanceTimersByTimeAsync(5000);
      await promise;

      expect(onCode).toHaveBeenCalledOnce();
      expect(onCode).toHaveBeenCalledWith(
        'ABCD1234',
        'https://microsoft.com/devicelogin',
      );
    });

    it('stores access and refresh tokens on success', async () => {
      mockFetchResponses(
        { json: mockDeviceCodeResponse },
        { json: mockTokenSuccess },
      );

      const promise = authenticateAdo();
      await vi.advanceTimersByTimeAsync(5000);
      await promise;

      expect(mockSetToken).toHaveBeenCalledWith('dev.azure.com', 'eyJ_access');
      expect(mockSetToken).toHaveBeenCalledWith(
        'dev.azure.com:refresh',
        'eyJ_refresh',
      );
    });

    it('throws on access_denied', async () => {
      mockFetchResponses(
        { json: mockDeviceCodeResponse },
        {
          json: {
            error: 'authorization_declined',
            error_description: 'User declined',
          },
        },
      );

      const promise = authenticateAdo();
      const rejection = expect(promise).rejects.toThrow(
        'Authorization was denied by the user',
      );
      await vi.advanceTimersByTimeAsync(5000);
      await rejection;
    });

    it('throws on expired_token', async () => {
      mockFetchResponses(
        { json: mockDeviceCodeResponse },
        { json: { error: 'expired_token' } },
      );

      const promise = authenticateAdo();
      const rejection = expect(promise).rejects.toThrow(
        'Device code has expired',
      );
      await vi.advanceTimersByTimeAsync(5000);
      await rejection;
    });

    it('increases polling interval on slow_down', async () => {
      const fetchMock = mockFetchResponses(
        { json: mockDeviceCodeResponse },
        { json: { error: 'slow_down' } },
        { json: mockTokenSuccess },
      );

      const promise = authenticateAdo();

      await vi.advanceTimersByTimeAsync(5000);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      // After slow_down, interval increases to 10s
      await vi.advanceTimersByTimeAsync(5000);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(5000);

      const token = await promise;
      expect(token).toBe('eyJ_access');
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('throws when device code request fails', async () => {
      mockFetchResponses({ ok: false, status: 500, json: {} });

      await expect(authenticateAdo()).rejects.toThrow(
        'Failed to request device code',
      );
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/auth/ado.test.ts`
Expected: FAIL — module `./ado.js` not found

**Step 3: Write implementation**

Create `src/auth/ado.ts`:

```typescript
import { getToken, setToken, deleteToken } from './keychain.js';

export const ADO_ACCOUNT = 'dev.azure.com';
export const ADO_REFRESH_ACCOUNT = 'dev.azure.com:refresh';
export const ADO_PAT_ACCOUNT = 'dev.azure.com:pat';

// Azure CLI's well-known public client ID — no app registration needed
export const AZURE_CLI_CLIENT_ID = '04b07795-8ddb-461a-bbee-02f9e1bf7b46';

const AUTHORITY = 'https://login.microsoftonline.com/organizations';
const ADO_SCOPE = '499b84ac-1321-427f-aa17-267ca6975798/.default offline_access';

export function getAdoToken(): string | null {
  return getToken(ADO_ACCOUNT);
}

export function getAdoRefreshToken(): string | null {
  return getToken(ADO_REFRESH_ACCOUNT);
}

export function getAdoPat(): string | null {
  return getToken(ADO_PAT_ACCOUNT);
}

export function setAdoPat(pat: string): void {
  setToken(ADO_PAT_ACCOUNT, pat);
}

export function clearAdoTokens(): void {
  deleteToken(ADO_ACCOUNT);
  deleteToken(ADO_REFRESH_ACCOUNT);
  deleteToken(ADO_PAT_ACCOUNT);
}

export interface AuthenticateAdoOptions {
  onCode?: (userCode: string, verificationUri: string) => void;
}

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
  message: string;
}

interface TokenSuccessResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
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

function urlEncode(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

/**
 * Refresh an expired access token using the stored refresh token.
 * Returns the new access token, or null if refresh fails.
 */
export async function refreshAdoToken(
  refreshToken: string,
): Promise<string | null> {
  try {
    const response = await fetch(`${AUTHORITY}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: urlEncode({
        client_id: AZURE_CLI_CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        scope: ADO_SCOPE,
      }),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as TokenPollResponse;
    if (isTokenError(data)) return null;

    setToken(ADO_ACCOUNT, data.access_token);
    if (data.refresh_token) {
      setToken(ADO_REFRESH_ACCOUNT, data.refresh_token);
    }
    return data.access_token;
  } catch {
    return null;
  }
}

/**
 * Run the Entra ID device code flow to authenticate with Azure DevOps.
 *
 * 1. Requests a device code from Entra ID
 * 2. Calls onCode callback so the caller can display the code/URL
 * 3. Polls for the access token at the specified interval
 * 4. Stores access + refresh tokens in keychain on success
 *
 * @returns The access token
 */
export async function authenticateAdo(
  options?: AuthenticateAdoOptions,
): Promise<string> {
  // Step 1: Request device code
  const codeResponse = await fetch(`${AUTHORITY}/oauth2/v2.0/devicecode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: urlEncode({
      client_id: AZURE_CLI_CLIENT_ID,
      scope: ADO_SCOPE,
    }),
  });

  if (!codeResponse.ok) {
    throw new Error(
      `Failed to request device code: ${codeResponse.status} ${codeResponse.statusText}`,
    );
  }

  const deviceCode = (await codeResponse.json()) as DeviceCodeResponse;

  // Step 2: Notify caller with user code and verification URL
  options?.onCode?.(deviceCode.user_code, deviceCode.verification_uri);

  // Step 3: Poll for access token
  let interval = deviceCode.interval * 1000;

  while (true) {
    await sleep(interval);

    const tokenResponse = await fetch(`${AUTHORITY}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: urlEncode({
        client_id: AZURE_CLI_CLIENT_ID,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: deviceCode.device_code,
      }),
    });

    if (!tokenResponse.ok) {
      // Entra ID returns 400 for pending/slow_down, parse the error
      const data = (await tokenResponse.json()) as TokenErrorResponse;
      switch (data.error) {
        case 'authorization_pending':
          continue;
        case 'slow_down':
          interval += 5000;
          continue;
        case 'authorization_declined':
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

    const data = (await tokenResponse.json()) as TokenSuccessResponse;

    // Success — store both tokens and return
    setToken(ADO_ACCOUNT, data.access_token);
    if (data.refresh_token) {
      setToken(ADO_REFRESH_ACCOUNT, data.refresh_token);
    }
    return data.access_token;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/auth/ado.test.ts`
Expected: All tests PASS

**Note:** Entra ID returns HTTP 400 (not 200) for pending/slow_down/denied errors, unlike GitHub which returns 200 with error in body. The test mock uses `ok: true` but the implementation handles `!response.ok` for the polling phase. **Adjust the test mocks accordingly** — the poll responses for `authorization_pending`, `slow_down`, and error cases should use `ok: false, status: 400`. Only the success response uses `ok: true, status: 200`.

**Step 5: Commit**

```bash
git add src/auth/ado.ts src/auth/ado.test.ts
git commit -m "feat(auth): add Entra ID device code flow for Azure DevOps"
```

---

## Task 2: Update Auth Exports and CLI

**Files:**
- Modify: `src/auth/index.ts`
- Modify: `src/cli/commands/auth.ts`

**Step 1: Update auth/index.ts**

Add ADO exports after the existing GitHub exports:

```typescript
export { getToken, setToken, deleteToken } from './keychain.js';
export {
  GITHUB_ACCOUNT,
  DEFAULT_CLIENT_ID,
  getGitHubToken,
  clearGitHubToken,
  authenticateGitHub,
} from './github.js';
export type { AuthenticateGitHubOptions } from './github.js';
export {
  ADO_ACCOUNT,
  ADO_REFRESH_ACCOUNT,
  ADO_PAT_ACCOUNT,
  AZURE_CLI_CLIENT_ID,
  getAdoToken,
  getAdoRefreshToken,
  getAdoPat,
  setAdoPat,
  clearAdoTokens,
  refreshAdoToken,
  authenticateAdo,
} from './ado.js';
export type { AuthenticateAdoOptions } from './ado.js';
```

**Step 2: Update cli/commands/auth.ts**

Replace the entire file:

```typescript
import {
  authenticateGitHub,
  clearGitHubToken,
  GITHUB_ACCOUNT,
} from '../../auth/github.js';
import {
  authenticateAdo,
  clearAdoTokens,
  setAdoPat,
  ADO_ACCOUNT,
  ADO_PAT_ACCOUNT,
} from '../../auth/ado.js';
import { getToken } from '../../auth/keychain.js';

const VALID_PROVIDERS = ['github', 'azure'] as const;
type Provider = (typeof VALID_PROVIDERS)[number];

function assertProvider(provider: string): asserts provider is Provider {
  if (!VALID_PROVIDERS.includes(provider as Provider)) {
    throw new Error(
      `Unknown provider "${provider}". Valid providers: ${VALID_PROVIDERS.join(', ')}`,
    );
  }
}

/**
 * Authenticate with a backend provider using the device code flow.
 * Supports: github, azure
 */
export async function runAuthLogin(
  provider: string,
  options?: { pat?: boolean },
): Promise<string> {
  assertProvider(provider);

  switch (provider) {
    case 'github':
      return authenticateGitHub({
        onCode(userCode, verificationUri) {
          console.log(`Open ${verificationUri} and enter code: ${userCode}`);
        },
      });
    case 'azure':
      if (options?.pat) {
        // Read PAT from stdin or prompt
        const pat = await readLine('Enter your Azure DevOps PAT: ');
        setAdoPat(pat);
        return pat;
      }
      return authenticateAdo({
        onCode(userCode, verificationUri) {
          console.log(`Open ${verificationUri} and enter code: ${userCode}`);
        },
      });
  }
}

/**
 * Return authentication status for all known providers.
 */
export function runAuthStatus(): {
  provider: string;
  authenticated: boolean;
  method?: string;
}[] {
  const adoToken = getToken(ADO_ACCOUNT);
  const adoPat = getToken(ADO_PAT_ACCOUNT);
  return [
    {
      provider: 'github',
      authenticated: getToken(GITHUB_ACCOUNT) !== null,
    },
    {
      provider: 'azure',
      authenticated: adoToken !== null || adoPat !== null,
      method: adoToken ? 'oauth' : adoPat ? 'pat' : undefined,
    },
  ];
}

/**
 * Remove stored credentials for a provider.
 */
export function runAuthLogout(provider: string): void {
  assertProvider(provider);

  switch (provider) {
    case 'github':
      clearGitHubToken();
      break;
    case 'azure':
      clearAdoTokens();
      break;
  }
}

function readLine(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.resume();
    process.stdin.once('data', (chunk: string) => {
      data = chunk.trim();
      process.stdin.pause();
      resolve(data);
    });
  });
}
```

**Step 3: Check if the CLI entry point passes `--pat` to `runAuthLogin`**

Read `src/cli/index.ts` and find the `auth login` command definition. Add `--pat` option to the `login` subcommand if not already there. The change should look like:

```typescript
// In the auth login command definition, add:
.option('--pat', 'Authenticate with a Personal Access Token')
// And pass it to runAuthLogin:
await runAuthLogin(provider, { pat: options.pat });
```

**Step 4: Run tests**

Run: `npx vitest run src/auth/ src/cli/`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/auth/index.ts src/cli/commands/auth.ts src/cli/index.ts
git commit -m "feat(auth): add azure provider to auth commands with PAT fallback"
```

---

## Task 3: ADO API Client

**Files:**
- Create: `src/backends/ado/api.ts`
- Test: `src/backends/ado/api.test.ts`

**Step 1: Write the test file**

Create `src/backends/ado/api.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdoApiClient } from './api.js';
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

describe('AdoApiClient', () => {
  let client: AdoApiClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    client = new AdoApiClient(
      { type: 'bearer', token: 'ado-token-123' },
      'contoso',
    );
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof globalThis.fetch;
  });

  describe('rest', () => {
    it('sends Bearer auth and api-version query param', async () => {
      const data = { id: 1, name: 'Bug' };
      fetchMock.mockResolvedValue(mockResponse(200, data));

      const result = await client.rest<typeof data>(
        'GET',
        '/MyProject/_apis/wit/workitems/1',
      );

      expect(fetchMock).toHaveBeenCalledWith(
        'https://dev.azure.com/contoso/MyProject/_apis/wit/workitems/1?api-version=7.1',
        {
          method: 'GET',
          headers: {
            Authorization: 'Bearer ado-token-123',
            Accept: 'application/json',
          },
        },
      );
      expect(result).toEqual(data);
    });

    it('sends Basic auth when using PAT', async () => {
      const patClient = new AdoApiClient(
        { type: 'basic', pat: 'my-pat-token' },
        'contoso',
      );
      fetchMock.mockResolvedValue(mockResponse(200, { ok: true }));

      await patClient.rest('GET', '/MyProject/_apis/wit/workitems/1');

      const expectedAuth =
        'Basic ' + Buffer.from(':my-pat-token').toString('base64');
      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: expectedAuth,
          }),
        }),
      );
    });

    it('sends JSON Patch body with correct content type', async () => {
      const patch = [
        { op: 'add', path: '/fields/System.Title', value: 'Bug fix' },
      ];
      fetchMock.mockResolvedValue(mockResponse(200, { id: 1 }));

      await client.rest(
        'PATCH',
        '/_apis/wit/workitems/1',
        patch,
        'application/json-patch+json',
      );

      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'PATCH',
          headers: expect.objectContaining({
            'Content-Type': 'application/json-patch+json',
          }),
          body: JSON.stringify(patch),
        }),
      );
    });

    it('appends api-version to URLs that already have query params', async () => {
      fetchMock.mockResolvedValue(mockResponse(200, {}));

      await client.rest('GET', '/project/_apis/wit/workitems/1?$expand=relations');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://dev.azure.com/contoso/project/_apis/wit/workitems/1?$expand=relations&api-version=7.1',
        expect.any(Object),
      );
    });

    it('throws AuthError on 401', async () => {
      fetchMock.mockResolvedValue(mockResponse(401, 'Unauthorized'));

      await expect(
        client.rest('GET', '/_apis/wit/workitems/1'),
      ).rejects.toThrow(AuthError);
    });

    it('retries on 5xx', async () => {
      fetchMock
        .mockResolvedValueOnce(mockResponse(500, 'Server Error'))
        .mockResolvedValueOnce(mockResponse(200, { id: 1 }));

      const result = await client.rest<{ id: number }>(
        'GET',
        '/_apis/wit/workitems/1',
      );

      expect(result).toEqual({ id: 1 });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('wiql', () => {
    it('posts WIQL query and returns work item references', async () => {
      const wiqlResult = {
        workItems: [{ id: 1 }, { id: 2 }, { id: 3 }],
      };
      fetchMock.mockResolvedValue(mockResponse(200, wiqlResult));

      const result = await client.wiql('MyProject', "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = 'MyProject'");

      expect(fetchMock).toHaveBeenCalledWith(
        'https://dev.azure.com/contoso/MyProject/_apis/wit/wiql?api-version=7.1',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            query: "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = 'MyProject'",
          }),
        }),
      );
      expect(result).toEqual(wiqlResult);
    });
  });

  describe('batchGetWorkItems', () => {
    it('posts batch request with IDs', async () => {
      const batchResult = {
        value: [
          { id: 1, fields: {} },
          { id: 2, fields: {} },
        ],
      };
      fetchMock.mockResolvedValue(mockResponse(200, batchResult));

      const result = await client.batchGetWorkItems([1, 2]);

      expect(fetchMock).toHaveBeenCalledWith(
        'https://dev.azure.com/contoso/_apis/wit/workitemsbatch?api-version=7.1',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ ids: [1, 2], $expand: 4 }),
        }),
      );
      expect(result).toEqual(batchResult);
    });

    it('chunks large batches into groups of 200', async () => {
      const ids = Array.from({ length: 450 }, (_, i) => i + 1);
      fetchMock
        .mockResolvedValueOnce(mockResponse(200, { value: [] }))
        .mockResolvedValueOnce(mockResponse(200, { value: [] }))
        .mockResolvedValueOnce(mockResponse(200, { value: [] }));

      await client.batchGetWorkItems(ids);

      expect(fetchMock).toHaveBeenCalledTimes(3);
      // First chunk: 200 items
      const firstBody = JSON.parse(
        fetchMock.mock.calls[0][1].body as string,
      ) as { ids: number[] };
      expect(firstBody.ids).toHaveLength(200);
      // Second chunk: 200 items
      const secondBody = JSON.parse(
        fetchMock.mock.calls[1][1].body as string,
      ) as { ids: number[] };
      expect(secondBody.ids).toHaveLength(200);
      // Third chunk: 50 items
      const thirdBody = JSON.parse(
        fetchMock.mock.calls[2][1].body as string,
      ) as { ids: number[] };
      expect(thirdBody.ids).toHaveLength(50);
    });
  });

  describe('paginate', () => {
    it('follows continuationToken across pages', async () => {
      fetchMock
        .mockResolvedValueOnce(
          mockResponse(200, { value: [{ id: 1 }], count: 1 }, { 'x-ms-continuationtoken': 'token1' }),
        )
        .mockResolvedValueOnce(
          mockResponse(200, { value: [{ id: 2 }], count: 1 }),
        );

      const pages: Array<{ id: number }[]> = [];
      for await (const page of client.paginate<{ id: number }>(
        '/MyProject/_apis/work/teamsettings/iterations',
      )) {
        pages.push(page);
      }

      expect(pages).toEqual([[{ id: 1 }], [{ id: 2 }]]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('yields single page when no continuationToken', async () => {
      fetchMock.mockResolvedValue(
        mockResponse(200, { value: [{ id: 1 }, { id: 2 }], count: 2 }),
      );

      const pages: Array<{ id: number }[]> = [];
      for await (const page of client.paginate<{ id: number }>(
        '/MyProject/_apis/wit/workitemtypes',
      )) {
        pages.push(page);
      }

      expect(pages).toEqual([[{ id: 1 }, { id: 2 }]]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/backends/ado/api.test.ts`
Expected: FAIL — module `./api.js` not found

**Step 3: Write implementation**

Create `src/backends/ado/api.ts`:

```typescript
import { BaseApiClient, AuthError } from '../shared/api-client.js';
import { getAdoRefreshToken, refreshAdoToken } from '../../auth/ado.js';

const ADO_API_VERSION = '7.1';

export type AdoAuth =
  | { type: 'bearer'; token: string }
  | { type: 'basic'; pat: string };

export class AdoApiClient extends BaseApiClient {
  private auth: AdoAuth;
  private org: string;

  constructor(auth: AdoAuth, org: string) {
    const token = auth.type === 'bearer' ? auth.token : auth.pat;
    super(token, `https://dev.azure.com/${org}`);
    this.auth = auth;
    this.org = org;
  }

  private getAuthHeader(): string {
    if (this.auth.type === 'bearer') {
      return `Bearer ${this.auth.token}`;
    }
    return `Basic ${Buffer.from(`:${this.auth.pat}`).toString('base64')}`;
  }

  private appendApiVersion(path: string): string {
    const separator = path.includes('?') ? '&' : '?';
    return `${path}${separator}api-version=${ADO_API_VERSION}`;
  }

  protected override async fetch<T>(
    method: string,
    path: string,
    body?: unknown,
    contentType?: string,
  ): Promise<T> {
    const url = this.baseUrl + this.appendApiVersion(path);

    const headers: Record<string, string> = {
      Authorization: this.getAuthHeader(),
      Accept: 'application/json',
    };

    const init: RequestInit = { method, headers };

    if (body !== undefined && ['POST', 'PATCH', 'PUT'].includes(method)) {
      headers['Content-Type'] = contentType ?? 'application/json';
      init.body = JSON.stringify(body);
    }

    let response = await globalThis.fetch(url, init);

    this.checkRateLimit(response.headers);

    // Try token refresh on 401 for OAuth auth
    if (response.status === 401 && this.auth.type === 'bearer') {
      const refreshToken = getAdoRefreshToken();
      if (refreshToken) {
        const newToken = await refreshAdoToken(refreshToken);
        if (newToken) {
          this.auth = { type: 'bearer', token: newToken };
          this.token = newToken;
          headers['Authorization'] = `Bearer ${newToken}`;
          response = await globalThis.fetch(url, { method, headers, body: init.body });
        }
      }
    }

    if (response.status === 401) {
      throw new AuthError();
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text}`);
    }

    return (await response.json()) as T;
  }

  async rest<T>(
    method: string,
    path: string,
    body?: unknown,
    contentType?: string,
  ): Promise<T> {
    return this.retry(() => this.fetch<T>(method, path, body, contentType));
  }

  async wiql<T>(project: string, query: string): Promise<T> {
    return this.rest<T>('POST', `/${project}/_apis/wit/wiql`, { query });
  }

  async batchGetWorkItems<T>(ids: number[]): Promise<T> {
    const CHUNK_SIZE = 200;
    const allValues: unknown[] = [];

    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
      const chunk = ids.slice(i, i + CHUNK_SIZE);
      const result = await this.rest<{ value: unknown[] }>(
        'POST',
        '/_apis/wit/workitemsbatch',
        { ids: chunk, $expand: 4 },
      );
      allValues.push(...result.value);
    }

    return { value: allValues } as T;
  }

  async *paginate<T>(path: string): AsyncGenerator<T[]> {
    let continuationToken: string | null = null;
    let isFirst = true;

    while (isFirst || continuationToken) {
      isFirst = false;
      const tokenParam = continuationToken
        ? `${path.includes('?') ? '&' : '?'}continuationToken=${continuationToken}`
        : '';
      const url = this.baseUrl + this.appendApiVersion(path + tokenParam);

      const headers: Record<string, string> = {
        Authorization: this.getAuthHeader(),
        Accept: 'application/json',
      };

      const response = await globalThis.fetch(url, { method: 'GET', headers });

      this.checkRateLimit(response.headers);

      if (response.status === 401) {
        throw new AuthError();
      }

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text}`);
      }

      const json = (await response.json()) as { value: T[]; count?: number };
      yield json.value;

      continuationToken =
        response.headers.get('x-ms-continuationtoken') ?? null;
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/backends/ado/api.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/backends/ado/api.ts src/backends/ado/api.test.ts
git commit -m "feat(ado): add AdoApiClient with WIQL, batch, and pagination support"
```

---

## Task 4: Migrate Backend Class

**Files:**
- Modify: `src/backends/ado/index.ts`
- Delete: `src/backends/ado/az.ts`
- Delete: `src/backends/ado/az.test.ts`

**Step 1: Rewrite `src/backends/ado/index.ts`**

Replace the entire file. Key changes:
- Private `constructor()` + static `async create()` factory (matches GitHub pattern)
- All `az*()` calls replaced with `this.api.*()` calls
- WIQL queries posted via `this.api.wiql()` instead of `az boards query`
- Create/update use JSON Patch body
- Comments use same API client (no more dual auth)
- Relations included in create/update JSON Patch where possible

```typescript
import { execFileSync } from 'node:child_process';
import { BaseBackend, UnsupportedOperationError } from '../types.js';
import type { BackendCapabilities } from '../types.js';
import type {
  WorkItem,
  NewWorkItem,
  NewComment,
  Comment,
  Template,
} from '../../types.js';
import { getAdoToken, getAdoPat, authenticateAdo } from '../../auth/ado.js';
import { AuthError } from '../shared/api-client.js';
import { AdoApiClient } from './api.js';
import type { AdoAuth } from './api.js';
import { parseAdoRemote } from './remote.js';
import {
  mapWorkItemToWorkItem,
  mapCommentToComment,
  mapPriorityToAdo,
  formatTags,
  extractParent,
  extractPredecessors,
} from './mappers.js';
import type { AdoWorkItem, AdoComment, AdoWorkItemType } from './mappers.js';

export interface AzureDevOpsBackendOptions {
  skipAuth?: boolean;
}

interface JsonPatchOp {
  op: 'add' | 'remove' | 'replace' | 'test';
  path: string;
  value?: unknown;
}

export class AzureDevOpsBackend extends BaseBackend {
  private api: AdoApiClient;
  private org: string;
  private project: string;
  private types: AdoWorkItemType[];

  private constructor(
    api: AdoApiClient,
    org: string,
    project: string,
    types: AdoWorkItemType[],
  ) {
    super(60_000);
    this.api = api;
    this.org = org;
    this.project = project;
    this.types = types;
  }

  static async create(
    cwd: string,
    options?: AzureDevOpsBackendOptions,
  ): Promise<AzureDevOpsBackend> {
    const remote = parseAdoRemote(cwd);

    let auth: AdoAuth | null = null;
    const token = getAdoToken();
    const pat = getAdoPat();

    if (token) {
      auth = { type: 'bearer', token };
    } else if (pat) {
      auth = { type: 'basic', pat };
    }

    if (!auth) {
      if (options?.skipAuth) {
        throw new AuthError(
          'Azure DevOps authentication required. Run "tic auth login azure" to authenticate.',
        );
      }
      const accessToken = await authenticateAdo({
        onCode: (code, url) => {
          console.log(`\nAzure DevOps authentication required.`);
          console.log(`Visit ${url} and enter code: ${code}\n`);
        },
      });
      auth = { type: 'bearer', token: accessToken };
    }

    const api = new AdoApiClient(auth, remote.org);

    // Fetch work item types to verify auth and cache type metadata
    const typesResult = await api.rest<{ value: AdoWorkItemType[] }>(
      'GET',
      `/${remote.project}/_apis/wit/workitemtypes`,
    );

    return new AzureDevOpsBackend(
      api,
      remote.org,
      remote.project,
      typesResult.value,
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
    const allStates = new Set<string>();
    for (const type of this.types) {
      for (const state of type.states) {
        allStates.add(state.name);
      }
    }
    return [...allStates];
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getWorkItemTypes(): Promise<string[]> {
    return this.types.map((t) => t.name);
  }

  async getAssignees(): Promise<string[]> {
    try {
      const result = await this.api.rest<{
        value: { identity: { displayName: string } }[];
      }>(
        'GET',
        `/_apis/projects/${encodeURIComponent(this.project)}/teams/${encodeURIComponent(this.project + ' Team')}/members`,
      );
      return result.value.map((m) => m.identity.displayName);
    } catch {
      return [];
    }
  }

  async getLabels(): Promise<string[]> {
    return this.getLabelsFromCache();
  }

  async getIterations(): Promise<string[]> {
    const result = await this.api.rest<{
      value: { path: string }[];
    }>(
      'GET',
      `/${encodeURIComponent(this.project)}/${encodeURIComponent(this.project + ' Team')}/_apis/work/teamsettings/iterations`,
    );
    return result.value.map((i) => i.path);
  }

  async getCurrentIteration(): Promise<string> {
    const result = await this.api.rest<{
      value: { path: string }[];
    }>(
      'GET',
      `/${encodeURIComponent(this.project)}/${encodeURIComponent(this.project + ' Team')}/_apis/work/teamsettings/iterations?$timeframe=current`,
    );
    return result.value[0]?.path ?? '';
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async setCurrentIteration(_name: string): Promise<void> {
    // No-op — current iteration is determined by date range in ADO
  }

  private escapeWiql(value: string): string {
    return value.replace(/'/g, "''");
  }

  private async batchFetchWorkItems(ids: number[]): Promise<WorkItem[]> {
    const result = await this.api.batchGetWorkItems<{
      value: AdoWorkItem[];
    }>(ids);
    return result.value.map(mapWorkItemToWorkItem);
  }

  async listWorkItems(iteration?: string): Promise<WorkItem[]> {
    let wiql = `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${this.escapeWiql(this.project)}'`;
    if (iteration) {
      wiql += ` AND [System.IterationPath] = '${this.escapeWiql(iteration)}'`;
    }

    const queryResult = await this.api.wiql<{
      workItems: { id: number }[];
    }>(this.project, wiql);

    const ids = queryResult.workItems.map((w) => w.id);
    if (ids.length === 0) return [];

    const items = await this.batchFetchWorkItems(ids);
    items.sort((a, b) => b.updated.localeCompare(a.updated));
    return items;
  }

  async getWorkItem(id: string): Promise<WorkItem> {
    const [ado, commentResult] = await Promise.all([
      this.api.rest<AdoWorkItem>(
        'GET',
        `/${encodeURIComponent(this.project)}/_apis/wit/workitems/${id}?$expand=relations`,
      ),
      this.api
        .rest<{ comments: AdoComment[] }>(
          'GET',
          `/${encodeURIComponent(this.project)}/_apis/wit/workItems/${id}/comments?api-version=7.1-preview.4`,
        )
        .catch(() => ({ comments: [] as AdoComment[] })),
    ]);

    const item = mapWorkItemToWorkItem(ado);
    item.comments = (commentResult.comments ?? []).map(mapCommentToComment);
    return item;
  }

  async createWorkItem(data: NewWorkItem): Promise<WorkItem> {
    this.validateFields(data);

    const patch: JsonPatchOp[] = [
      { op: 'add', path: '/fields/System.Title', value: data.title },
    ];

    if (data.status)
      patch.push({ op: 'add', path: '/fields/System.State', value: data.status });
    if (data.iteration)
      patch.push({
        op: 'add',
        path: '/fields/System.IterationPath',
        value: data.iteration,
      });
    if (data.priority)
      patch.push({
        op: 'add',
        path: '/fields/Microsoft.VSTS.Common.Priority',
        value: mapPriorityToAdo(data.priority),
      });
    if (data.assignee)
      patch.push({
        op: 'add',
        path: '/fields/System.AssignedTo',
        value: data.assignee,
      });
    if (data.labels.length > 0)
      patch.push({
        op: 'add',
        path: '/fields/System.Tags',
        value: formatTags(data.labels),
      });
    if (data.description)
      patch.push({
        op: 'add',
        path: '/fields/System.Description',
        value: data.description,
      });

    // Add parent relation in same request
    if (data.parent) {
      patch.push({
        op: 'add',
        path: '/relations/-',
        value: {
          rel: 'System.LinkTypes.Hierarchy-Reverse',
          url: `https://dev.azure.com/${this.org}/_apis/wit/workitems/${data.parent}`,
        },
      });
    }

    // Add dependency relations in same request
    for (const depId of data.dependsOn) {
      patch.push({
        op: 'add',
        path: '/relations/-',
        value: {
          rel: 'System.LinkTypes.Dependency-Reverse',
          url: `https://dev.azure.com/${this.org}/_apis/wit/workitems/${depId}`,
        },
      });
    }

    const created = await this.api.rest<AdoWorkItem>(
      'POST',
      `/${encodeURIComponent(this.project)}/_apis/wit/workitems/$${encodeURIComponent(data.type)}`,
      patch,
      'application/json-patch+json',
    );

    return this.getWorkItem(String(created.id));
  }

  async updateWorkItem(id: string, data: Partial<WorkItem>): Promise<WorkItem> {
    this.validateFields(data);

    const patch: JsonPatchOp[] = [];

    if (data.title !== undefined)
      patch.push({ op: 'replace', path: '/fields/System.Title', value: data.title });
    if (data.status !== undefined)
      patch.push({ op: 'replace', path: '/fields/System.State', value: data.status });
    if (data.iteration !== undefined)
      patch.push({
        op: 'replace',
        path: '/fields/System.IterationPath',
        value: data.iteration,
      });
    if (data.priority !== undefined)
      patch.push({
        op: 'replace',
        path: '/fields/Microsoft.VSTS.Common.Priority',
        value: mapPriorityToAdo(data.priority),
      });
    if (data.assignee !== undefined)
      patch.push({
        op: 'replace',
        path: '/fields/System.AssignedTo',
        value: data.assignee,
      });
    if (data.labels !== undefined)
      patch.push({
        op: 'replace',
        path: '/fields/System.Tags',
        value: formatTags(data.labels),
      });
    if (data.description !== undefined)
      patch.push({
        op: 'replace',
        path: '/fields/System.Description',
        value: data.description,
      });

    // Handle relation changes — need to fetch current relations first
    if (data.parent !== undefined || data.dependsOn !== undefined) {
      const current = await this.api.rest<AdoWorkItem>(
        'GET',
        `/${encodeURIComponent(this.project)}/_apis/wit/workitems/${id}?$expand=relations`,
      );

      if (data.parent !== undefined) {
        const currentParent = extractParent(current.relations);

        if (currentParent && currentParent !== data.parent) {
          // Find the index of the parent relation to remove it
          const parentIdx = current.relations?.findIndex(
            (r) => r.rel === 'System.LinkTypes.Hierarchy-Reverse',
          );
          if (parentIdx !== undefined && parentIdx >= 0) {
            patch.push({
              op: 'remove',
              path: `/relations/${parentIdx}`,
            });
          }
        }
        if (data.parent && data.parent !== currentParent) {
          patch.push({
            op: 'add',
            path: '/relations/-',
            value: {
              rel: 'System.LinkTypes.Hierarchy-Reverse',
              url: `https://dev.azure.com/${this.org}/_apis/wit/workitems/${data.parent}`,
            },
          });
        }
      }

      if (data.dependsOn !== undefined) {
        const currentDeps = new Set(extractPredecessors(current.relations));
        const newDeps = new Set(data.dependsOn);

        // Remove deps no longer in the list (iterate in reverse to preserve indices)
        const removeIndices: number[] = [];
        current.relations?.forEach((r, i) => {
          if (r.rel === 'System.LinkTypes.Dependency-Reverse') {
            const depId = r.url.match(/\/workitems\/(\d+)$/i)?.[1];
            if (depId && !newDeps.has(depId)) {
              removeIndices.push(i);
            }
          }
        });
        for (const idx of removeIndices.reverse()) {
          patch.push({ op: 'remove', path: `/relations/${idx}` });
        }

        // Add new deps
        for (const dep of newDeps) {
          if (!currentDeps.has(dep)) {
            patch.push({
              op: 'add',
              path: '/relations/-',
              value: {
                rel: 'System.LinkTypes.Dependency-Reverse',
                url: `https://dev.azure.com/${this.org}/_apis/wit/workitems/${dep}`,
              },
            });
          }
        }
      }
    }

    if (patch.length > 0) {
      await this.api.rest(
        'PATCH',
        `/_apis/wit/workitems/${id}`,
        patch,
        'application/json-patch+json',
      );
    }

    return this.getWorkItem(id);
  }

  async deleteWorkItem(id: string): Promise<void> {
    await this.api.rest('DELETE', `/_apis/wit/workitems/${id}`);
  }

  async addComment(workItemId: string, comment: NewComment): Promise<Comment> {
    await this.api.rest(
      'POST',
      `/${encodeURIComponent(this.project)}/_apis/wit/workItems/${workItemId}/comments?api-version=7.1-preview.4`,
      { text: comment.body },
    );

    return {
      author: comment.author,
      date: new Date().toISOString(),
      body: comment.body,
    };
  }

  override async getChildren(id: string): Promise<WorkItem[]> {
    const numericId = parseInt(id, 10);
    if (isNaN(numericId)) throw new Error(`Invalid work item ID: "${id}"`);

    const wiql = `SELECT [System.Id] FROM WorkItemLinks WHERE [Source].[System.Id] = ${numericId} AND [System.Links.LinkType] = 'System.LinkTypes.Hierarchy-Forward' MODE (MustContain)`;

    const queryResult = await this.api.wiql<{
      workItemRelations: { target: { id: number } }[];
    }>(this.project, wiql);

    const ids = queryResult.workItemRelations
      .map((r) => r.target.id)
      .filter((wid) => wid !== numericId);
    if (ids.length === 0) return [];

    return this.batchFetchWorkItems(ids);
  }

  override async getDependents(id: string): Promise<WorkItem[]> {
    const numericId = parseInt(id, 10);
    if (isNaN(numericId)) throw new Error(`Invalid work item ID: "${id}"`);

    const wiql = `SELECT [System.Id] FROM WorkItemLinks WHERE [Source].[System.Id] = ${numericId} AND [System.Links.LinkType] = 'System.LinkTypes.Dependency-Forward' MODE (MustContain)`;

    const queryResult = await this.api.wiql<{
      workItemRelations: { target: { id: number } }[];
    }>(this.project, wiql);

    const ids = queryResult.workItemRelations
      .map((r) => r.target.id)
      .filter((wid) => wid !== numericId);
    if (ids.length === 0) return [];

    return this.batchFetchWorkItems(ids);
  }

  getItemUrl(id: string): string {
    return `https://dev.azure.com/${this.org}/${encodeURIComponent(this.project)}/_workitems/edit/${id}`;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async openItem(id: string): Promise<void> {
    const url = this.getItemUrl(id);
    execFileSync('open', [url]);
  }

  /* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unused-vars */
  async listTemplates(): Promise<Template[]> {
    throw new UnsupportedOperationError('templates', 'AzureDevOpsBackend');
  }
  async getTemplate(_slug: string): Promise<Template> {
    throw new UnsupportedOperationError('templates', 'AzureDevOpsBackend');
  }
  async createTemplate(_template: Template): Promise<Template> {
    throw new UnsupportedOperationError('templates', 'AzureDevOpsBackend');
  }
  async updateTemplate(
    _oldSlug: string,
    _template: Template,
  ): Promise<Template> {
    throw new UnsupportedOperationError('templates', 'AzureDevOpsBackend');
  }
  async deleteTemplate(_slug: string): Promise<void> {
    throw new UnsupportedOperationError('templates', 'AzureDevOpsBackend');
  }
  /* eslint-enable @typescript-eslint/require-await, @typescript-eslint/no-unused-vars */
}
```

**Step 2: Delete az.ts and az.test.ts**

```bash
rm src/backends/ado/az.ts src/backends/ado/az.test.ts
```

**Step 3: Update the existing ado.test.ts**

The test file currently mocks `az.js` functions. Rewrite it to mock the `AdoApiClient` and `create()` factory instead. Key changes:

- Mock `./api.js` instead of `./az.js`
- Mock `../../auth/ado.js` for `getAdoToken`/`getAdoPat`
- Mock `./remote.js` (unchanged)
- Replace `makeBackend()` with `await AzureDevOpsBackend.create('/repo')`
- All test assertions change from checking `az*` call args to checking `api.rest`/`api.wiql` call args

**Note on WIQL response shape:** The current tests return `{ id: number }[]` from `az boards query`. The REST API returns `{ workItems: { id: number }[] }` for flat queries and `{ workItemRelations: { target: { id: number } }[] }` for link queries. Update mocks accordingly.

**Step 4: Run all tests**

Run: `npx vitest run src/backends/ado/`
Expected: All tests PASS

**Step 5: Run full test suite**

Run: `npm test`
Expected: All tests PASS (ensure no other files imported from `az.js`)

**Step 6: Commit**

```bash
git add -A
git commit -m "feat(ado)!: migrate Azure DevOps backend to direct API"
```

---

## Task 5: Update Factory and Store

**Files:**
- Modify: `src/backends/factory.ts`
- (No change needed to `src/stores/backendDataStore.ts` — it already catches `AuthError`)

**Step 1: Update factory.ts**

In `createRemoteBackend`, change the `azure` case from:

```typescript
case 'azure': {
  const { AzureDevOpsBackend } = await import('./ado/index.js');
  return new AzureDevOpsBackend(root);
}
```

To:

```typescript
case 'azure': {
  const { AzureDevOpsBackend } = await import('./ado/index.js');
  return AzureDevOpsBackend.create(root, options);
}
```

**Step 2: Verify backendDataStore already handles this**

Read `src/stores/backendDataStore.ts` lines 87-95. The `AuthError` catch is already generic — it catches any `AuthError` from any backend. No change needed.

**Step 3: Run full test suite**

Run: `npm test`
Expected: All tests PASS

**Step 4: Commit**

```bash
git add src/backends/factory.ts
git commit -m "feat(ado): use async create() factory in backend factory"
```

---

## Task 6: Build Verification and Cleanup

**Step 1: Run format**

Run: `npm run format`

**Step 2: Run lint**

Run: `npm run lint`
Fix any issues.

**Step 3: Run type check**

Run: `npx tsc --noEmit`
Fix any type errors.

**Step 4: Run full test suite**

Run: `npm test`
Expected: All tests PASS

**Step 5: Commit any fixes**

```bash
git add -A
git commit -m "chore: fix formatting and lint issues"
```

**Step 6: Verify no references to az.ts remain**

Search the codebase for any remaining imports of `./az.js` or `./az`:
```bash
grep -r "from.*['\"].*\/az['\"]" src/ --include="*.ts" --include="*.tsx"
grep -r "from.*['\"].*\/az\.js['\"]" src/ --include="*.ts" --include="*.tsx"
```

Expected: No matches (only `az.ts` imports should have existed in `ado/index.ts` and `ado/ado.test.ts`, both now rewritten).

---

## Task 7: Update backendDataStore Dynamic Import

**Files:**
- Modify: `src/stores/backendDataStore.ts` — the `createBackendAndSync()` function has its own dynamic import path for creating backends (separate from `factory.ts`). Check if it creates ADO backends directly — if so, update to use `AzureDevOpsBackend.create()`.

**Step 1: Read and check**

Read `src/stores/backendDataStore.ts` `createBackendAndSync()`. It delegates to `createRemoteBackend()` from factory.ts (line 85-88), so the factory change in Task 5 is sufficient. No additional change needed.

**Step 2: Verify with test**

Run: `npx vitest run src/stores/`
Expected: PASS

---

## Summary

| Task | Description | Key Files |
|------|-------------|-----------|
| 1 | ADO auth (Entra ID device flow + PAT) | `src/auth/ado.ts`, `src/auth/ado.test.ts` |
| 2 | Auth exports + CLI commands | `src/auth/index.ts`, `src/cli/commands/auth.ts` |
| 3 | ADO API client | `src/backends/ado/api.ts`, `src/backends/ado/api.test.ts` |
| 4 | Migrate backend class | `src/backends/ado/index.ts`, delete `az.ts` |
| 5 | Update factory | `src/backends/factory.ts` |
| 6 | Build verification | Format, lint, type check, test |
| 7 | Verify store integration | `src/stores/backendDataStore.ts` (read-only check) |
