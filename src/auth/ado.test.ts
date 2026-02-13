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
  getAdoToken,
  getAdoRefreshToken,
  getAdoPat,
  clearAdoTokens,
  authenticateAdo,
  ADO_ACCOUNT,
  ADO_REFRESH_ACCOUNT,
  ADO_PAT_ACCOUNT,
  AZURE_CLI_CLIENT_ID,
} from './ado.js';

describe('ado auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constants', () => {
    it('exports the correct account names', () => {
      expect(ADO_ACCOUNT).toBe('dev.azure.com');
      expect(ADO_REFRESH_ACCOUNT).toBe('dev.azure.com:refresh');
      expect(ADO_PAT_ACCOUNT).toBe('dev.azure.com:pat');
    });

    it('exports the Azure CLI client ID', () => {
      expect(AZURE_CLI_CLIENT_ID).toBe('04b07795-8ddb-461a-bbee-02f9e1bf7b46');
    });
  });

  describe('getAdoToken', () => {
    it('returns stored token from keychain', () => {
      mockGetToken.mockReturnValue('eyJ...');
      const result = getAdoToken();
      expect(mockGetToken).toHaveBeenCalledWith('dev.azure.com');
      expect(result).toBe('eyJ...');
    });

    it('returns null when no token is stored', () => {
      mockGetToken.mockReturnValue(null);
      const result = getAdoToken();
      expect(result).toBeNull();
    });
  });

  describe('getAdoRefreshToken', () => {
    it('returns stored refresh token', () => {
      mockGetToken.mockReturnValue('refresh_token_abc');
      const result = getAdoRefreshToken();
      expect(mockGetToken).toHaveBeenCalledWith('dev.azure.com:refresh');
      expect(result).toBe('refresh_token_abc');
    });
  });

  describe('getAdoPat', () => {
    it('returns stored PAT', () => {
      mockGetToken.mockReturnValue('pat_abc');
      const result = getAdoPat();
      expect(mockGetToken).toHaveBeenCalledWith('dev.azure.com:pat');
      expect(result).toBe('pat_abc');
    });
  });

  describe('clearAdoTokens', () => {
    it('deletes all ADO keychain entries', () => {
      clearAdoTokens();
      expect(mockDeleteToken).toHaveBeenCalledWith('dev.azure.com');
      expect(mockDeleteToken).toHaveBeenCalledWith('dev.azure.com:refresh');
      expect(mockDeleteToken).toHaveBeenCalledWith('dev.azure.com:pat');
    });
  });

  describe('authenticateAdo', () => {
    const mockDeviceCodeResponse = {
      device_code: 'dc_test123',
      user_code: 'ABCD1234',
      verification_uri: 'https://microsoft.com/devicelogin',
      expires_in: 900,
      interval: 5,
      message:
        'To sign in, use a web browser to open the page https://microsoft.com/devicelogin and enter the code ABCD1234 to authenticate.',
    };

    const mockTokenSuccess = {
      access_token: 'eyJ_access',
      refresh_token: 'eyJ_refresh',
      token_type: 'Bearer',
      expires_in: 3600,
      scope: '499b84ac-1321-427f-aa17-267ca6975798/.default',
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
        // Device code request — HTTP 200
        { json: mockDeviceCodeResponse },
        // First poll — Entra ID returns HTTP 400 for authorization_pending
        {
          ok: false,
          status: 400,
          json: { error: 'authorization_pending' },
        },
        // Second poll — success, HTTP 200
        { json: mockTokenSuccess },
      );

      const promise = authenticateAdo();

      await vi.advanceTimersByTimeAsync(5000);
      await vi.advanceTimersByTimeAsync(5000);

      const token = await promise;

      expect(token).toBe('eyJ_access');
      expect(fetchMock).toHaveBeenCalledTimes(3);

      // Verify device code request
      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        'https://login.microsoftonline.com/organizations/oauth2/v2.0/devicecode',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        }),
      );

      // Verify token poll request
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        'https://login.microsoftonline.com/organizations/oauth2/v2.0/token',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        }),
      );
    });

    it('calls onCode callback with user code and verification URI', async () => {
      mockFetchResponses(
        { json: mockDeviceCodeResponse },
        { json: mockTokenSuccess },
      );

      const onCode = vi.fn();
      const promise = authenticateAdo({ onCode });
      await vi.advanceTimersByTimeAsync(5000);
      await promise;

      expect(onCode).toHaveBeenCalledOnce();
      expect(onCode).toHaveBeenCalledWith(
        'ABCD1234',
        'https://microsoft.com/devicelogin',
      );
    });

    it('stores access and refresh tokens on success', async () => {
      mockFetchResponses(
        { json: mockDeviceCodeResponse },
        { json: mockTokenSuccess },
      );

      const promise = authenticateAdo();
      await vi.advanceTimersByTimeAsync(5000);
      await promise;

      expect(mockSetToken).toHaveBeenCalledWith('dev.azure.com', 'eyJ_access');
      expect(mockSetToken).toHaveBeenCalledWith(
        'dev.azure.com:refresh',
        'eyJ_refresh',
      );
    });

    it('throws on access_denied', async () => {
      mockFetchResponses(
        { json: mockDeviceCodeResponse },
        // Entra ID returns HTTP 400 for authorization_declined
        {
          ok: false,
          status: 400,
          json: {
            error: 'authorization_declined',
            error_description: 'User declined',
          },
        },
      );

      const promise = authenticateAdo();
      const rejection = expect(promise).rejects.toThrow(
        'Authorization was denied by the user',
      );
      await vi.advanceTimersByTimeAsync(5000);
      await rejection;
    });

    it('throws on expired_token', async () => {
      mockFetchResponses(
        { json: mockDeviceCodeResponse },
        // Entra ID returns HTTP 400 for expired_token
        {
          ok: false,
          status: 400,
          json: { error: 'expired_token' },
        },
      );

      const promise = authenticateAdo();
      const rejection = expect(promise).rejects.toThrow(
        'Device code has expired',
      );
      await vi.advanceTimersByTimeAsync(5000);
      await rejection;
    });

    it('increases polling interval on slow_down', async () => {
      const fetchMock = mockFetchResponses(
        { json: mockDeviceCodeResponse },
        // Entra ID returns HTTP 400 for slow_down
        { ok: false, status: 400, json: { error: 'slow_down' } },
        { json: mockTokenSuccess },
      );

      const promise = authenticateAdo();

      await vi.advanceTimersByTimeAsync(5000);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      // After slow_down, interval increases to 10s
      await vi.advanceTimersByTimeAsync(5000);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(5000);

      const token = await promise;
      expect(token).toBe('eyJ_access');
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('throws when device code expires due to polling timeout', async () => {
      const shortExpiryDevice = {
        ...mockDeviceCodeResponse,
        expires_in: 2,
        interval: 1,
      };
      const fetchMock = vi.fn();
      // Device code request
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve(shortExpiryDevice),
      });
      // All polls return authorization_pending (Entra ID uses HTTP 400)
      fetchMock.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: () => Promise.resolve({ error: 'authorization_pending' }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const promise = authenticateAdo();
      const rejection = expect(promise).rejects.toThrow(
        'Device code has expired. Please restart the authentication flow.',
      );

      // Advance past the 2s deadline
      await vi.advanceTimersByTimeAsync(1000); // first poll
      await vi.advanceTimersByTimeAsync(1000); // second poll
      await vi.advanceTimersByTimeAsync(1000); // past deadline

      await rejection;
    });

    it('throws when device code request fails', async () => {
      mockFetchResponses({ ok: false, status: 500, json: {} });

      await expect(authenticateAdo()).rejects.toThrow(
        'Failed to request device code',
      );
    });
  });
});
