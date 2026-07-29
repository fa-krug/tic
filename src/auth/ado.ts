import { getToken, setToken, deleteToken } from './keychain.js';
import { DEFAULT_TIMEOUT_MS } from '../backends/shared/api-client.js';

export const ADO_ACCOUNT = 'dev.azure.com';
export const ADO_REFRESH_ACCOUNT = 'dev.azure.com:refresh';
export const ADO_PAT_ACCOUNT = 'dev.azure.com:pat';

// Azure CLI's well-known public client ID — no app registration needed
export const AZURE_CLI_CLIENT_ID = '04b07795-8ddb-461a-bbee-02f9e1bf7b46';

const AUTHORITY = 'https://login.microsoftonline.com/organizations';
const ADO_SCOPE =
  '499b84ac-1321-427f-aa17-267ca6975798/.default offline_access';

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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(`${AUTHORITY}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: urlEncode({
          client_id: AZURE_CLI_CLIENT_ID,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          scope: ADO_SCOPE,
        }),
        signal: controller.signal,
      });
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error('Request timed out', { cause: error });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

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
 * Note: Entra ID returns HTTP 400 (not 200) for pending/slow_down/denied
 * errors during polling, unlike GitHub which returns 200 with error in body.
 *
 * @returns The access token
 */
export async function authenticateAdo(
  options?: AuthenticateAdoOptions,
): Promise<string> {
  // Step 1: Request device code
  const codeController = new AbortController();
  const codeTimeout = setTimeout(
    () => codeController.abort(),
    DEFAULT_TIMEOUT_MS,
  );

  let codeResponse: Response;
  try {
    codeResponse = await fetch(`${AUTHORITY}/oauth2/v2.0/devicecode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: urlEncode({
        client_id: AZURE_CLI_CLIENT_ID,
        scope: ADO_SCOPE,
      }),
      signal: codeController.signal,
    });
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Request timed out', { cause: error });
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
  let interval = deviceCode.interval * 1000;
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
      tokenResponse = await fetch(`${AUTHORITY}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: urlEncode({
          client_id: AZURE_CLI_CLIENT_ID,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          device_code: deviceCode.device_code,
        }),
        signal: tokenController.signal,
      });
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error('Request timed out', { cause: error });
      }
      throw error;
    } finally {
      clearTimeout(tokenTimeout);
    }

    // Entra ID returns 400 for pending/slow_down/declined/expired errors
    if (!tokenResponse.ok) {
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

  throw new Error(
    'Device code has expired. Please restart the authentication flow.',
  );
}
