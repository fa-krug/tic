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
import {
  authenticateGitLab,
  clearGitLabTokens,
  setGitLabPat,
  GITLAB_ACCOUNT,
  GITLAB_PAT_ACCOUNT,
} from '../../auth/gitlab.js';
import {
  getJiraCredentials,
  setJiraCredentials,
  removeJiraCredentials,
} from '../../auth/jira.js';
import { JiraApiClient } from '../../backends/jira/api.js';
import { getToken } from '../../auth/keychain.js';
import { configStore } from '../../stores/configStore.js';

const VALID_PROVIDERS = ['github', 'azure', 'ado', 'gitlab', 'jira'] as const;
type Provider = (typeof VALID_PROVIDERS)[number];

function assertProvider(provider: string): asserts provider is Provider {
  if (!VALID_PROVIDERS.includes(provider as Provider)) {
    throw new Error(
      `Unknown provider "${provider}". Valid providers: github, azure, ado, gitlab, jira`,
    );
  }
}

/**
 * Authenticate with a backend provider using the device code flow.
 * Supports: github, azure, ado, gitlab
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
    case 'ado':
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
    case 'gitlab':
      if (options?.pat) {
        const pat = await readLine('Enter your GitLab PAT: ');
        setGitLabPat(pat);
        return pat;
      }
      return authenticateGitLab({
        onCode(userCode, verificationUri) {
          console.log(`Open ${verificationUri} and enter code: ${userCode}`);
        },
      });
    case 'jira': {
      const site = await readLine('Jira site (e.g. mycompany.atlassian.net): ');
      const email = await readLine('Email: ');
      const token = await readLine('API token: ');
      const api = new JiraApiClient(email, token, site);
      await api.rest('GET', '/api/3/myself');
      setJiraCredentials(site, email, token);
      return token;
    }
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
  const gitlabToken = getToken(GITLAB_ACCOUNT);
  const gitlabPat = getToken(GITLAB_PAT_ACCOUNT);
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
    {
      provider: 'gitlab',
      authenticated: gitlabToken !== null || gitlabPat !== null,
      method: gitlabToken ? 'oauth' : gitlabPat ? 'pat' : undefined,
    },
    (() => {
      const jiraSite = configStore
        .getState()
        .config.jira?.site?.replace(/^https?:\/\//, '');
      const jiraCreds = jiraSite ? getJiraCredentials(jiraSite) : null;
      return {
        provider: 'jira',
        authenticated: jiraCreds !== null,
        method: jiraCreds ? 'api-token' : undefined,
      };
    })(),
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
    case 'ado':
    case 'azure':
      clearAdoTokens();
      break;
    case 'gitlab':
      clearGitLabTokens();
      break;
    case 'jira': {
      const jiraSite = configStore
        .getState()
        .config.jira?.site?.replace(/^https?:\/\//, '');
      if (jiraSite) {
        removeJiraCredentials(jiraSite);
      }
      break;
    }
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
