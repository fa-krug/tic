import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockGetToken, mockSetToken, mockDeleteToken } = vi.hoisted(() => {
  return {
    mockGetToken: vi.fn(),
    mockSetToken: vi.fn(),
    mockDeleteToken: vi.fn(),
  };
});

vi.mock('./keychain.js', () => ({
  getToken: mockGetToken,
  setToken: mockSetToken,
  deleteToken: mockDeleteToken,
}));

import {
  getGitLabToken,
  getGitLabPat,
  setGitLabPat,
  clearGitLabTokens,
  authenticateGitLab,
  GITLAB_ACCOUNT,
  GITLAB_PAT_ACCOUNT,
  DEFAULT_GITLAB_CLIENT_ID,
} from './gitlab.js';

describe('gitlab auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constants', () => {
    it('exports the correct account name', () => {
      expect(GITLAB_ACCOUNT).toBe('gitlab.com');
    });

    it('exports the correct PAT account name', () => {
      expect(GITLAB_PAT_ACCOUNT).toBe('gitlab.com:pat');
    });

    it('exports the default client ID', () => {
      expect(DEFAULT_GITLAB_CLIENT_ID).toBe(
        'cdcaceeece0df785f6df0e8b94fce6669ec8521787844faed02a5605b29e05bd',
      );
    });
  });

  describe('getGitLabToken', () => {
    it('returns stored token from keychain', () => {
      mockGetToken.mockReturnValue('glpat-abc123');

      const result = getGitLabToken();

      expect(mockGetToken).toHaveBeenCalledWith('gitlab.com');
      expect(result).toBe('glpat-abc123');
    });

    it('returns null when no token is stored', () => {
      mockGetToken.mockReturnValue(null);

      const result = getGitLabToken();

      expect(mockGetToken).toHaveBeenCalledWith('gitlab.com');
      expect(result).toBeNull();
    });
  });

  describe('getGitLabPat', () => {
    it('returns stored PAT from keychain', () => {
      mockGetToken.mockReturnValue('glpat-pat123');

      const result = getGitLabPat();

      expect(mockGetToken).toHaveBeenCalledWith('gitlab.com:pat');
      expect(result).toBe('glpat-pat123');
    });

    it('returns null when no PAT is stored', () => {
      mockGetToken.mockReturnValue(null);

      const result = getGitLabPat();

      expect(mockGetToken).toHaveBeenCalledWith('gitlab.com:pat');
      expect(result).toBeNull();
    });
  });

  describe('setGitLabPat', () => {
    it('stores PAT in keychain', () => {
      setGitLabPat('glpat-newpat456');

      expect(mockSetToken).toHaveBeenCalledWith(
        'gitlab.com:pat',
        'glpat-newpat456',
      );
    });
  });

  describe('clearGitLabTokens', () => {
    it('deletes both OAuth and PAT tokens from keychain', () => {
      clearGitLabTokens();

      expect(mockDeleteToken).toHaveBeenCalledWith('gitlab.com');
      expect(mockDeleteToken).toHaveBeenCalledWith('gitlab.com:pat');
      expect(mockDeleteToken).toHaveBeenCalledTimes(2);
    });
  });

  describe('authenticateGitLab', () => {
    const mockDeviceCodeResponse = {
      device_code: 'dc_gl_test123',
      user_code: 'GLAB-5678',
      verification_uri: 'https://gitlab.com/oauth/authorize_device',
      expires_in: 900,
      interval: 5,
    };

    const mockTokenSuccess = {
      access_token: 'gl_oauth_token123',
      token_type: 'bearer',
      scope: 'api',
    };

    function mockFetchResponses(
      ...responses: Array<{ ok?: boolean; status?: number; json: unknown }>
    ) {
      const fetchMock = vi.fn();
      for (const resp of responses) {
        fetchMock.mockResolvedValueOnce({
          ok: resp.ok ?? true,
          status: resp.status ?? 200,
          statusText: 'OK',
          json: () => Promise.resolve(resp.json),
        });
      }
      vi.stubGlobal('fetch', fetchMock);
      return fetchMock;
    }

    it('completes the full device flow successfully', async () => {
      const fetchMock = mockFetchResponses(
        { json: mockDeviceCodeResponse },
        // GitLab returns authorization_pending as HTTP 400 per RFC 8628
        { ok: false, status: 400, json: { error: 'authorization_pending' } },
        { json: mockTokenSuccess },
      );

      const promise = authenticateGitLab();

      // Advance past first poll interval (5s)
      await vi.advanceTimersByTimeAsync(5000);
      // Advance past second poll interval (5s)
      await vi.advanceTimersByTimeAsync(5000);

      const token = await promise;

      expect(token).toBe('gl_oauth_token123');
      expect(fetchMock).toHaveBeenCalledTimes(3);

      // Verify device code request uses form-encoded body
      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        'https://gitlab.com/oauth/authorize_device',
        expect.objectContaining({
          method: 'POST',
          body: `client_id=${encodeURIComponent(DEFAULT_GITLAB_CLIENT_ID)}&scope=api`,
        }),
      );

      // Verify token poll request uses form-encoded body
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        'https://gitlab.com/oauth/token',
        expect.objectContaining({
          method: 'POST',
          body: `client_id=${encodeURIComponent(DEFAULT_GITLAB_CLIENT_ID)}&device_code=dc_gl_test123&grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:device_code')}`,
        }),
      );
    });

    it('uses a custom client ID when provided', async () => {
      const fetchMock = mockFetchResponses(
        { json: mockDeviceCodeResponse },
        { json: mockTokenSuccess },
      );

      const promise = authenticateGitLab({ clientId: 'custom_gl_client_id' });
      await vi.advanceTimersByTimeAsync(5000);
      await promise;

      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        'https://gitlab.com/oauth/authorize_device',
        expect.objectContaining({
          body: 'client_id=custom_gl_client_id&scope=api',
        }),
      );

      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        'https://gitlab.com/oauth/token',
        expect.objectContaining({
          body: `client_id=custom_gl_client_id&device_code=dc_gl_test123&grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:device_code')}`,
        }),
      );
    });

    it('calls onCode callback with user code and verification URI', async () => {
      mockFetchResponses(
        { json: mockDeviceCodeResponse },
        { json: mockTokenSuccess },
      );

      const onCode = vi.fn();
      const promise = authenticateGitLab({ onCode });
      await vi.advanceTimersByTimeAsync(5000);
      await promise;

      expect(onCode).toHaveBeenCalledOnce();
      expect(onCode).toHaveBeenCalledWith(
        'GLAB-5678',
        'https://gitlab.com/oauth/authorize_device',
      );
    });

    it('stores token via setToken on success', async () => {
      mockFetchResponses(
        { json: mockDeviceCodeResponse },
        { json: mockTokenSuccess },
      );

      const promise = authenticateGitLab();
      await vi.advanceTimersByTimeAsync(5000);
      await promise;

      expect(mockSetToken).toHaveBeenCalledWith(
        'gitlab.com',
        'gl_oauth_token123',
      );
    });

    it('throws on access_denied', async () => {
      mockFetchResponses(
        { json: mockDeviceCodeResponse },
        { ok: false, status: 400, json: { error: 'access_denied' } },
      );

      const promise = authenticateGitLab();
      const rejection = expect(promise).rejects.toThrow(
        'Authorization was denied by the user',
      );
      await vi.advanceTimersByTimeAsync(5000);
      await rejection;
    });

    it('throws on expired_token', async () => {
      mockFetchResponses(
        { json: mockDeviceCodeResponse },
        { ok: false, status: 400, json: { error: 'expired_token' } },
      );

      const promise = authenticateGitLab();
      const rejection = expect(promise).rejects.toThrow(
        'Device code has expired. Please restart the authentication flow.',
      );
      await vi.advanceTimersByTimeAsync(5000);
      await rejection;
    });

    it('increases polling interval on slow_down', async () => {
      const fetchMock = mockFetchResponses(
        { json: mockDeviceCodeResponse },
        // GitLab returns slow_down as HTTP 400 per RFC 8628
        { ok: false, status: 400, json: { error: 'slow_down' } },
        { json: mockTokenSuccess },
      );

      const promise = authenticateGitLab();

      // First poll at 5s
      await vi.advanceTimersByTimeAsync(5000);
      expect(fetchMock).toHaveBeenCalledTimes(2); // device code + first poll

      // After slow_down, interval increases to 10s (5s + 5s)
      // Advancing 5s should NOT trigger another poll
      await vi.advanceTimersByTimeAsync(5000);
      expect(fetchMock).toHaveBeenCalledTimes(2); // still 2

      // Advancing another 5s (total 10s since slow_down) should trigger next poll
      await vi.advanceTimersByTimeAsync(5000);

      const token = await promise;
      expect(token).toBe('gl_oauth_token123');
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('throws when device code request fails', async () => {
      mockFetchResponses({
        ok: false,
        status: 500,
        json: {},
      });

      await expect(authenticateGitLab()).rejects.toThrow(
        'Failed to request device code',
      );
    });

    it('throws when token poll response is not parseable JSON', async () => {
      const fetchMock = vi.fn();
      // Device code request succeeds
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve(mockDeviceCodeResponse),
      });
      // Token poll returns non-JSON error
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.reject(new Error('not json')),
      });
      vi.stubGlobal('fetch', fetchMock);

      const promise = authenticateGitLab();
      const rejection = expect(promise).rejects.toThrow(
        'Failed to poll for token: 500 Internal Server Error',
      );
      await vi.advanceTimersByTimeAsync(5000);
      await rejection;
    });

    it('handles unknown error types', async () => {
      mockFetchResponses(
        { json: mockDeviceCodeResponse },
        {
          ok: false,
          status: 400,
          json: {
            error: 'some_unknown_error',
            error_description: 'Something went wrong',
          },
        },
      );

      const promise = authenticateGitLab();
      const rejection = expect(promise).rejects.toThrow(
        'Authentication failed: some_unknown_error - Something went wrong',
      );
      await vi.advanceTimersByTimeAsync(5000);
      await rejection;
    });
  });
});
