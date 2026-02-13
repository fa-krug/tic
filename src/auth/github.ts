import { getToken, setToken, deleteToken } from './keychain.js';
import { DEFAULT_TIMEOUT_MS } from '../backends/shared/api-client.js';

export const GITHUB_ACCOUNT = 'github.com';
export const DEFAULT_CLIENT_ID = 'Ov23lizRXsY0iSURg1he';

/**
 * Retrieve the stored GitHub token from the system keychain.
 * Returns null if no token is found.
 */
export function getGitHubToken(): string | null {
  return getToken(GITHUB_ACCOUNT);
}

/**
 * Remove the stored GitHub token from the system keychain.
 */
export function clearGitHubToken(): void {
  deleteToken(GITHUB_ACCOUNT);
}

export interface AuthenticateGitHubOptions {
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
 * Run the GitHub OAuth device flow to authenticate the user.
 *
 * 1. Requests a device code from GitHub
 * 2. Calls onCode callback so the caller can display the code/URL to the user
 * 3. Polls GitHub for the access token at the specified interval
 * 4. Stores the token in the system keychain on success
 *
 * @returns The access token
 * @throws On access_denied, expired_token, or unexpected errors
 */
export async function authenticateGitHub(
  options?: AuthenticateGitHubOptions,
): Promise<string> {
  const clientId = options?.clientId ?? DEFAULT_CLIENT_ID;

  // Step 1: Request device code
  const codeController = new AbortController();
  const codeTimeout = setTimeout(
    () => codeController.abort(),
    DEFAULT_TIMEOUT_MS,
  );

  let codeResponse: Response;
  try {
    codeResponse = await fetch('https://github.com/login/device/code', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        scope: 'repo',
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
  const deadline = Date.now() + deviceCode.expires_in * 1000;

  while (Date.now() < deadline) {
    await sleep(interval);

    const tokenController = new AbortController();
    const tokenTimeout = setTimeout(
      () => tokenController.abort(),
      DEFAULT_TIMEOUT_MS,
    );

    let tokenResponse: Response;
    try {
      tokenResponse = await fetch(
        'https://github.com/login/oauth/access_token',
        {
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
        },
      );
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
          // GitHub wants us to increase the polling interval by 5 seconds
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
    setToken(GITHUB_ACCOUNT, data.access_token);
    return data.access_token;
  }

  throw new Error(
    'Device code has expired. Please restart the authentication flow.',
  );
}
