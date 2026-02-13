import { getToken, setToken, deleteToken } from './keychain.js';

export const JIRA_ACCOUNT_PREFIX = 'jira:';

export interface JiraCredentials {
  email: string;
  token: string;
}

/**
 * Retrieve stored Jira credentials from the system keychain.
 * Returns null if no credentials are found for the given site.
 */
export function getJiraCredentials(site: string): JiraCredentials | null {
  const stored = getToken(`${JIRA_ACCOUNT_PREFIX}${site}`);
  if (!stored) return null;

  const idx = stored.indexOf(':');
  if (idx < 0) return null;

  return {
    email: stored.slice(0, idx),
    token: stored.slice(idx + 1),
  };
}

/**
 * Store Jira credentials in the system keychain.
 */
export function setJiraCredentials(
  site: string,
  email: string,
  token: string,
): void {
  setToken(`${JIRA_ACCOUNT_PREFIX}${site}`, `${email}:${token}`);
}

/**
 * Remove Jira credentials from the system keychain.
 */
export function removeJiraCredentials(site: string): void {
  deleteToken(`${JIRA_ACCOUNT_PREFIX}${site}`);
}
