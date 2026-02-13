import { getToken, setToken, deleteToken } from './keychain.js';
import { DEFAULT_TIMEOUT_MS } from '../backends/shared/api-client.js';

export const GITLAB_ACCOUNT = 'gitlab.com';
export const GITLAB_PAT_ACCOUNT = 'gitlab.com:pat';
export const DEFAULT_GITLAB_CLIENT_ID =
  'cdcaceeece0df785f6df0e8b94fce6669ec8521787844faed02a5605b29e05bd';

/**
 * Retrieve the stored GitLab OAuth token from the system keychain.
 * Returns null if no token is found.
 */
export function getGitLabToken(): string | null {
  return getToken(GITLAB_ACCOUNT);
}

/**
 * Retrieve the stored GitLab PAT from the system keychain.
 * Returns null if no PAT is found.
 */
export function getGitLabPat(): string | null {
  return getToken(GITLAB_PAT_ACCOUNT);
}

/**
 * Store a GitLab PAT in the system keychain.
 */
export function setGitLabPat(pat: string): void {
  setToken(GITLAB_PAT_ACCOUNT, pat);
}

/**
 * Remove all stored GitLab tokens (OAuth and PAT) from the system keychain.
 */
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

/**
 * Run the GitLab OAuth device flow to authenticate the user.
 *
 * 1. Requests a device code from GitLab
 * 2. Calls onCode callback so the caller can display the code/URL to the user
 * 3. Polls GitLab for the access token at the specified interval
 * 4. Stores the token in the system keychain on success
 *
 * @returns The access token
 * @throws On access_denied, expired_token, or unexpected errors
 */
export async function authenticateGitLab(
  options?: AuthenticateGitLabOptions,
): Promise<string> {
  const clientId = options?.clientId ?? DEFAULT_GITLAB_CLIENT_ID;

  // Step 1: Request device code
  const codeController = new AbortController();
  const codeTimeout = setTimeout(
    () => codeController.abort(),
    DEFAULT_TIMEOUT_MS,
  );

  let codeResponse: Response;
  try {
    codeResponse = await fetch('https://gitlab.com/oauth/authorize_device', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        scope: 'api',
      }),
      signal: codeController.signal,
    });
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Request timed out');
    }
    throw error;
  } finally {
    clearTimeout(codeTimeout);
  }

  if (!codeResponse.ok) {
    throw new Error(
      `Failed to request device code: ${codeResponse.status} ${codeResponse.statusText}`,
    );
  }

  const deviceCode = (await codeResponse.json()) as DeviceCodeResponse;

  // Step 2: Notify caller with user code and verification URL
  options?.onCode?.(deviceCode.user_code, deviceCode.verification_uri);

  // Step 3: Poll for access token
  let interval = deviceCode.interval * 1000; // Convert to ms

  while (true) {
    await sleep(interval);

    const tokenController = new AbortController();
    const tokenTimeout = setTimeout(
      () => tokenController.abort(),
      DEFAULT_TIMEOUT_MS,
    );

    let tokenResponse: Response;
    try {
      tokenResponse = await fetch('https://gitlab.com/oauth/token', {
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
        signal: tokenController.signal,
      });
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error('Request timed out');
      }
      throw error;
    } finally {
      clearTimeout(tokenTimeout);
    }

    if (!tokenResponse.ok) {
      throw new Error(
        `Failed to poll for token: ${tokenResponse.status} ${tokenResponse.statusText}`,
      );
    }

    const data = (await tokenResponse.json()) as TokenPollResponse;

    if (isTokenError(data)) {
      switch (data.error) {
        case 'authorization_pending':
          // User hasn't authorized yet, keep polling
          continue;
        case 'slow_down':
          // GitLab wants us to increase the polling interval by 5 seconds
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

    // Success - store token and return
    setToken(GITLAB_ACCOUNT, data.access_token);
    return data.access_token;
  }
}
