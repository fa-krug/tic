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
