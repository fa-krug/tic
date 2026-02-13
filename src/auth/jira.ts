import { getToken, setToken, deleteToken } from './keychain.js';

export const JIRA_ACCOUNT_PREFIX = 'jira:';

export interface JiraCredentials {
  email: string;
  token: string;
}

export function getJiraCredentials(site: string): JiraCredentials | null {
  const stored = getToken(`${JIRA_ACCOUNT_PREFIX}${site}`);
  if (!stored) return null;

  let idx = stored.indexOf('\0');
  if (idx < 0) {
    idx = stored.indexOf(':');
  }
  if (idx < 0) return null;

  return {
    email: stored.slice(0, idx),
    token: stored.slice(idx + 1),
  };
}

export function setJiraCredentials(
  site: string,
  email: string,
  token: string,
): void {
  setToken(`${JIRA_ACCOUNT_PREFIX}${site}`, `${email}\0${token}`);
}

export function removeJiraCredentials(site: string): void {
  deleteToken(`${JIRA_ACCOUNT_PREFIX}${site}`);
}
