import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./keychain.js', () => ({
  getToken: vi.fn(),
  setToken: vi.fn(),
  deleteToken: vi.fn(),
}));

import { getToken, setToken, deleteToken } from './keychain.js';
import {
  getJiraCredentials,
  setJiraCredentials,
  removeJiraCredentials,
  JIRA_ACCOUNT_PREFIX,
} from './jira.js';

const mockGetToken = vi.mocked(getToken);
const mockSetToken = vi.mocked(setToken);
const mockDeleteToken = vi.mocked(deleteToken);

describe('Jira auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getJiraCredentials', () => {
    it('returns email and token from null byte separator', () => {
      mockGetToken.mockReturnValue('user@corp.com\0ABCdef123');
      const creds = getJiraCredentials('mycompany.atlassian.net');
      expect(mockGetToken).toHaveBeenCalledWith('jira:mycompany.atlassian.net');
      expect(creds).toEqual({ email: 'user@corp.com', token: 'ABCdef123' });
    });

    it('returns null when no credentials stored', () => {
      mockGetToken.mockReturnValue(null);
      expect(getJiraCredentials('mycompany.atlassian.net')).toBeNull();
    });

    it('falls back to colon separator for legacy credentials', () => {
      mockGetToken.mockReturnValue('user@corp.com:ABCdef123');
      const creds = getJiraCredentials('mycompany.atlassian.net');
      expect(creds).toEqual({ email: 'user@corp.com', token: 'ABCdef123' });
    });

    it('handles tokens containing colons with null byte separator', () => {
      mockGetToken.mockReturnValue('user@corp.com\0ABC:def:123');
      const creds = getJiraCredentials('mycompany.atlassian.net');
      expect(creds).toEqual({ email: 'user@corp.com', token: 'ABC:def:123' });
    });
  });

  describe('setJiraCredentials', () => {
    it('stores email and token with null byte separator', () => {
      setJiraCredentials(
        'mycompany.atlassian.net',
        'user@corp.com',
        'token123',
      );
      expect(mockSetToken).toHaveBeenCalledWith(
        'jira:mycompany.atlassian.net',
        'user@corp.com\0token123',
      );
    });
  });

  describe('removeJiraCredentials', () => {
    it('deletes from keychain', () => {
      removeJiraCredentials('mycompany.atlassian.net');
      expect(mockDeleteToken).toHaveBeenCalledWith(
        'jira:mycompany.atlassian.net',
      );
    });
  });

  describe('JIRA_ACCOUNT_PREFIX', () => {
    it('equals "jira:"', () => {
      expect(JIRA_ACCOUNT_PREFIX).toBe('jira:');
    });
  });
});
