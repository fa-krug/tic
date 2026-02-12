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
  getGitHubToken,
  clearGitHubToken,
  authenticateGitHub,
  GITHUB_ACCOUNT,
  DEFAULT_CLIENT_ID,
} from './github.js';

describe('github auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constants', () => {
    it('exports the correct account name', () => {
      expect(GITHUB_ACCOUNT).toBe('github.com');
    });

    it('exports the default client ID', () => {
      expect(DEFAULT_CLIENT_ID).toBe('Ov23lizRXsY0iSURg1he');
    });
  });

  describe('getGitHubToken', () => {
    it('returns stored token from keychain', () => {
      mockGetToken.mockReturnValue('ghp_abc123');

      const result = getGitHubToken();

      expect(mockGetToken).toHaveBeenCalledWith('github.com');
      expect(result).toBe('ghp_abc123');
    });

    it('returns null when no token is stored', () => {
      mockGetToken.mockReturnValue(null);

      const result = getGitHubToken();

      expect(mockGetToken).toHaveBeenCalledWith('github.com');
      expect(result).toBeNull();
    });
  });

  describe('clearGitHubToken', () => {
    it('calls deleteToken with the GitHub account', () => {
      clearGitHubToken();

      expect(mockDeleteToken).toHaveBeenCalledWith('github.com');
    });
  });

  describe('authenticateGitHub', () => {
    const mockDeviceCodeResponse = {
      device_code: 'dc_test123',
      user_code: 'ABCD-1234',
      verification_uri: 'https://github.com/login/device',
      expires_in: 900,
      interval: 5,
    };

    const mockTokenSuccess = {
      access_token: 'gho_token123',
      token_type: 'bearer',
      scope: 'repo',
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
        { json: { error: 'authorization_pending' } },
        { json: mockTokenSuccess },
      );

      const promise = authenticateGitHub();

      // Advance past first poll interval (5s)
      await vi.advanceTimersByTimeAsync(5000);
      // Advance past second poll interval (5s)
      await vi.advanceTimersByTimeAsync(5000);

      const token = await promise;

      expect(token).toBe('gho_token123');
      expect(fetchMock).toHaveBeenCalledTimes(3);

      // Verify device code request
      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        'https://github.com/login/device/code',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            client_id: DEFAULT_CLIENT_ID,
            scope: 'repo',
          }),
        }),
      );

      // Verify token poll request
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        'https://github.com/login/oauth/access_token',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            client_id: DEFAULT_CLIENT_ID,
            device_code: 'dc_test123',
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          }),
        }),
      );
    });

    it('uses a custom client ID when provided', async () => {
      const fetchMock = mockFetchResponses(
        { json: mockDeviceCodeResponse },
        { json: mockTokenSuccess },
      );

      const promise = authenticateGitHub({ clientId: 'custom_client_id' });
      await vi.advanceTimersByTimeAsync(5000);
      await promise;

      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        'https://github.com/login/device/code',
        expect.objectContaining({
          body: JSON.stringify({
            client_id: 'custom_client_id',
            scope: 'repo',
          }),
        }),
      );

      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        'https://github.com/login/oauth/access_token',
        expect.objectContaining({
          body: JSON.stringify({
            client_id: 'custom_client_id',
            device_code: 'dc_test123',
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          }),
        }),
      );
    });

    it('calls onCode callback with user code and verification URI', async () => {
      mockFetchResponses(
        { json: mockDeviceCodeResponse },
        { json: mockTokenSuccess },
      );

      const onCode = vi.fn();
      const promise = authenticateGitHub({ onCode });
      await vi.advanceTimersByTimeAsync(5000);
      await promise;

      expect(onCode).toHaveBeenCalledOnce();
      expect(onCode).toHaveBeenCalledWith(
        'ABCD-1234',
        'https://github.com/login/device',
      );
    });

    it('stores token via setToken on success', async () => {
      mockFetchResponses(
        { json: mockDeviceCodeResponse },
        { json: mockTokenSuccess },
      );

      const promise = authenticateGitHub();
      await vi.advanceTimersByTimeAsync(5000);
      await promise;

      expect(mockSetToken).toHaveBeenCalledWith('github.com', 'gho_token123');
    });

    it('throws on access_denied', async () => {
      mockFetchResponses(
        { json: mockDeviceCodeResponse },
        { json: { error: 'access_denied' } },
      );

      const promise = authenticateGitHub();
      const rejection = expect(promise).rejects.toThrow(
        'Authorization was denied by the user',
      );
      await vi.advanceTimersByTimeAsync(5000);
      await rejection;
    });

    it('throws on expired_token', async () => {
      mockFetchResponses(
        { json: mockDeviceCodeResponse },
        { json: { error: 'expired_token' } },
      );

      const promise = authenticateGitHub();
      const rejection = expect(promise).rejects.toThrow(
        'Device code has expired. Please restart the authentication flow.',
      );
      await vi.advanceTimersByTimeAsync(5000);
      await rejection;
    });

    it('increases polling interval on slow_down', async () => {
      const fetchMock = mockFetchResponses(
        { json: mockDeviceCodeResponse },
        { json: { error: 'slow_down' } },
        { json: mockTokenSuccess },
      );

      const promise = authenticateGitHub();

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
      expect(token).toBe('gho_token123');
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('throws when device code request fails', async () => {
      mockFetchResponses({
        ok: false,
        status: 500,
        json: {},
      });

      await expect(authenticateGitHub()).rejects.toThrow(
        'Failed to request device code',
      );
    });

    it('throws when token poll request fails', async () => {
      mockFetchResponses(
        { json: mockDeviceCodeResponse },
        { ok: false, status: 500, json: {} },
      );

      const promise = authenticateGitHub();
      const rejection = expect(promise).rejects.toThrow(
        'Failed to poll for token',
      );
      await vi.advanceTimersByTimeAsync(5000);
      await rejection;
    });

    it('handles unknown error types', async () => {
      mockFetchResponses(
        { json: mockDeviceCodeResponse },
        {
          json: {
            error: 'some_unknown_error',
            error_description: 'Something went wrong',
          },
        },
      );

      const promise = authenticateGitHub();
      const rejection = expect(promise).rejects.toThrow(
        'Authentication failed: some_unknown_error - Something went wrong',
      );
      await vi.advanceTimersByTimeAsync(5000);
      await rejection;
    });
  });
});
