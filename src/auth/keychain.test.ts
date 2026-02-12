import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetPassword, mockSetPassword, mockDeletePassword, MockEntry } =
  vi.hoisted(() => {
    const mockGetPassword = vi.fn();
    const mockSetPassword = vi.fn();
    const mockDeletePassword = vi.fn();
    const MockEntry = vi.fn(function (this: unknown) {
      const self = this as Record<string, unknown>;
      self['getPassword'] = mockGetPassword;
      self['setPassword'] = mockSetPassword;
      self['deletePassword'] = mockDeletePassword;
    });
    return { mockGetPassword, mockSetPassword, mockDeletePassword, MockEntry };
  });

vi.mock('@napi-rs/keyring', () => ({
  Entry: MockEntry,
}));

import { getToken, setToken, deleteToken } from './keychain.js';

describe('keychain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getToken', () => {
    it('returns the stored token', () => {
      mockGetPassword.mockReturnValue('ghp_abc123');

      const result = getToken('github.com');

      expect(MockEntry).toHaveBeenCalledWith('tic', 'github.com');
      expect(result).toBe('ghp_abc123');
    });

    it('returns null when no token is found', () => {
      mockGetPassword.mockImplementation(() => {
        throw new Error('No password found');
      });

      const result = getToken('github.com');

      expect(result).toBeNull();
    });

    it('returns null for any error type', () => {
      mockGetPassword.mockImplementation(() => {
        throw new TypeError('credential not found');
      });

      const result = getToken('github.com');

      expect(result).toBeNull();
    });

    it('uses the correct account parameter', () => {
      mockGetPassword.mockReturnValue('glpat_xyz');

      getToken('gitlab.com');

      expect(MockEntry).toHaveBeenCalledWith('tic', 'gitlab.com');
    });
  });

  describe('setToken', () => {
    it('stores a token in the keychain', () => {
      setToken('github.com', 'ghp_abc123');

      expect(MockEntry).toHaveBeenCalledWith('tic', 'github.com');
      expect(mockSetPassword).toHaveBeenCalledWith('ghp_abc123');
    });

    it('stores tokens for different accounts', () => {
      setToken('gitlab.com', 'glpat_xyz');

      expect(MockEntry).toHaveBeenCalledWith('tic', 'gitlab.com');
      expect(mockSetPassword).toHaveBeenCalledWith('glpat_xyz');
    });

    it('overwrites an existing token', () => {
      setToken('github.com', 'ghp_new_token');

      expect(MockEntry).toHaveBeenCalledWith('tic', 'github.com');
      expect(mockSetPassword).toHaveBeenCalledWith('ghp_new_token');
    });
  });

  describe('deleteToken', () => {
    it('removes a token from the keychain', () => {
      deleteToken('github.com');

      expect(MockEntry).toHaveBeenCalledWith('tic', 'github.com');
      expect(mockDeletePassword).toHaveBeenCalled();
    });

    it('is a no-op when no token exists', () => {
      mockDeletePassword.mockImplementation(() => {
        throw new Error('No password found');
      });

      expect(() => deleteToken('github.com')).not.toThrow();
    });

    it('uses the correct account parameter', () => {
      deleteToken('dev.azure.com');

      expect(MockEntry).toHaveBeenCalledWith('tic', 'dev.azure.com');
    });
  });
});
