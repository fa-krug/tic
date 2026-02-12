import {
  authenticateGitHub,
  clearGitHubToken,
  GITHUB_ACCOUNT,
} from '../../auth/github.js';
import { getToken } from '../../auth/keychain.js';

const VALID_PROVIDERS = ['github'] as const;
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
 * Currently supports: github
 */
export async function runAuthLogin(provider: string): Promise<string> {
  assertProvider(provider);

  switch (provider) {
    case 'github':
      return authenticateGitHub({
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
}[] {
  return [
    {
      provider: 'github',
      authenticated: getToken(GITHUB_ACCOUNT) !== null,
    },
  ];
}

/**
 * Remove stored credentials for a provider.
 * Currently supports: github
 */
export function runAuthLogout(provider: string): void {
  assertProvider(provider);

  switch (provider) {
    case 'github':
      clearGitHubToken();
      break;
  }
}
