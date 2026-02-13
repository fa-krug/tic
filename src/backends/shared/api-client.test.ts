import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthError, RateLimitError, BaseApiClient } from './api-client.js';

class TestApiClient extends BaseApiClient {
  async testFetch<T>(method: string, path: string, body?: unknown): Promise<T> {
    return this.fetch<T>(method, path, body);
  }

  async testRetry<T>(fn: () => Promise<T>): Promise<T> {
    return this.retry<T>(fn);
  }

  testCheckRateLimit(headers: Headers): void {
    this.checkRateLimit(headers);
  }

  async *paginate<T>(path: string): AsyncGenerator<T[]> {
    const result = await this.fetch<T[]>('GET', path);
    yield result;
  }
}

function mockResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  const headersObj = new Headers(headers);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: headersObj,
    json: vi.fn().mockResolvedValue(body),
    text: vi
      .fn()
      .mockResolvedValue(
        typeof body === 'string' ? body : JSON.stringify(body),
      ),
  } as unknown as Response;
}

describe('BaseApiClient', () => {
  let client: TestApiClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    client = new TestApiClient('test-token', 'https://api.example.com');
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof globalThis.fetch;
  });

  describe('fetch', () => {
    it('makes request with auth headers and returns JSON', async () => {
      const data = { id: 1, name: 'test' };
      fetchMock.mockResolvedValue(mockResponse(200, data));

      const result = await client.testFetch<typeof data>('GET', '/items');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.example.com/items',
        expect.objectContaining({
          method: 'GET',
          headers: {
            Authorization: 'Bearer test-token',
            Accept: 'application/json',
          },
        }),
      );
      expect(result).toEqual(data);
    });

    it('sends JSON body for POST', async () => {
      const body = { title: 'New item' };
      const data = { id: 1, title: 'New item' };
      fetchMock.mockResolvedValue(mockResponse(200, data));

      await client.testFetch('POST', '/items', body);

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.example.com/items',
        expect.objectContaining({
          method: 'POST',
          headers: {
            Authorization: 'Bearer test-token',
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        }),
      );
    });

    it('throws AuthError on 401', async () => {
      fetchMock.mockResolvedValue(mockResponse(401, 'Unauthorized'));

      await expect(client.testFetch('GET', '/items')).rejects.toThrow(
        AuthError,
      );
    });

    it('throws RateLimitError on 403 with rate limit headers', async () => {
      fetchMock.mockResolvedValue(
        mockResponse(403, 'Forbidden', {
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': '1700000000',
        }),
      );

      await expect(client.testFetch('GET', '/items')).rejects.toThrow(
        RateLimitError,
      );

      try {
        await client.testFetch('GET', '/items');
      } catch (error) {
        expect(error).toBeInstanceOf(RateLimitError);
        expect((error as RateLimitError).resetAt).toEqual(
          new Date(1700000000 * 1000),
        );
      }
    });

    it('throws generic error on 500', async () => {
      fetchMock.mockResolvedValue(mockResponse(500, 'Internal Server Error'));

      await expect(client.testFetch('GET', '/items')).rejects.toThrow(
        'HTTP 500: Request failed',
      );
    });

    it('throws "Request timed out" when fetch is aborted', async () => {
      fetchMock.mockImplementation(() => {
        throw new DOMException('The operation was aborted', 'AbortError');
      });

      await expect(client.testFetch('GET', '/items')).rejects.toThrow(
        'Request timed out',
      );
    });

    it('passes AbortSignal to fetch', async () => {
      const data = { id: 1 };
      fetchMock.mockResolvedValue(mockResponse(200, data));

      await client.testFetch('GET', '/items');

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(init.signal?.aborted).toBe(false);
    });
  });

  describe('retry', () => {
    it('retries once on 5xx and succeeds', async () => {
      let callCount = 0;
      const fn = () => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error('HTTP 500: Request failed'));
        }
        return Promise.resolve('success');
      };

      const result = await client.testRetry(fn);
      expect(result).toBe('success');
      expect(callCount).toBe(2);
    });

    it('throws after retry fails on 5xx', async () => {
      const fn = () => {
        return Promise.reject(new Error('HTTP 502: Request failed'));
      };

      await expect(client.testRetry(fn)).rejects.toThrow(
        'HTTP 502: Request failed',
      );
    });

    it('does NOT retry AuthError', async () => {
      let callCount = 0;
      const fn = () => {
        callCount++;
        return Promise.reject(new AuthError());
      };

      await expect(client.testRetry(fn)).rejects.toThrow(AuthError);
      expect(callCount).toBe(1);
    });

    it('does NOT retry RateLimitError', async () => {
      let callCount = 0;
      const fn = () => {
        callCount++;
        return Promise.reject(new RateLimitError(new Date()));
      };

      await expect(client.testRetry(fn)).rejects.toThrow(RateLimitError);
      expect(callCount).toBe(1);
    });
  });

  describe('checkRateLimit', () => {
    it('warns when remaining < 100', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const headers = new Headers({ 'X-RateLimit-Remaining': '50' });
      client.testCheckRateLimit(headers);

      expect(warnSpy).toHaveBeenCalledWith(
        'API rate limit warning: 50 requests remaining',
      );
    });

    it('does not warn when remaining >= 100', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const headers = new Headers({ 'X-RateLimit-Remaining': '500' });
      client.testCheckRateLimit(headers);

      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('does not warn when header is absent', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const headers = new Headers();
      client.testCheckRateLimit(headers);

      expect(warnSpy).not.toHaveBeenCalled();
    });
  });
});
