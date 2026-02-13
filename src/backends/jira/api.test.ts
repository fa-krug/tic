import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JiraApiClient } from './api.js';
import { AuthError } from '../shared/api-client.js';

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

describe('JiraApiClient', () => {
  let client: JiraApiClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    client = new JiraApiClient(
      'user@example.com',
      'jira-api-token',
      'mysite.atlassian.net',
    );
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof globalThis.fetch;
  });

  describe('rest', () => {
    it('sends Basic auth header with base64-encoded email:token', async () => {
      const data = { id: '10001', key: 'PROJ-1' };
      fetchMock.mockResolvedValue(mockResponse(200, data));

      const result = await client.rest<typeof data>(
        'GET',
        '/api/3/issue/PROJ-1',
      );

      const expectedAuth = `Basic ${Buffer.from('user@example.com:jira-api-token').toString('base64')}`;

      expect(fetchMock).toHaveBeenCalledWith(
        'https://mysite.atlassian.net/rest/api/3/issue/PROJ-1',
        expect.objectContaining({
          method: 'GET',
          headers: {
            Authorization: expectedAuth,
            Accept: 'application/json',
          },
          signal: expect.any(AbortSignal) as unknown,
        }),
      );
      expect(result).toEqual(data);
    });

    it('sends JSON body on POST', async () => {
      const body = {
        fields: { summary: 'New issue', description: 'Description' },
      };
      const data = { id: '10001', key: 'PROJ-1' };
      fetchMock.mockResolvedValue(mockResponse(200, data));

      await client.rest('POST', '/api/3/issue', body);

      const expectedAuth = `Basic ${Buffer.from('user@example.com:jira-api-token').toString('base64')}`;

      expect(fetchMock).toHaveBeenCalledWith(
        'https://mysite.atlassian.net/rest/api/3/issue',
        expect.objectContaining({
          method: 'POST',
          headers: {
            Authorization: expectedAuth,
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: expect.any(AbortSignal) as unknown,
        }),
      );
    });

    it('throws AuthError on 401', async () => {
      fetchMock.mockResolvedValue(mockResponse(401, 'Unauthorized'));

      await expect(client.rest('GET', '/api/3/issue/PROJ-1')).rejects.toThrow(
        AuthError,
      );
    });

    it('throws with Jira error messages on non-ok response', async () => {
      const errorBody = {
        errorMessages: ['Issue does not exist'],
        errors: { summary: 'Field is required' },
      };
      fetchMock.mockResolvedValue(mockResponse(400, errorBody));

      await expect(
        client.rest('POST', '/api/3/issue', { fields: {} }),
      ).rejects.toThrow(
        'Jira API error: Issue does not exist; summary: Field is required',
      );
    });

    it('throws generic HTTP error when response has no Jira error format', async () => {
      fetchMock.mockResolvedValue(mockResponse(500, 'Internal Server Error'));

      // First call fails with 5xx, retry also fails with 5xx
      fetchMock
        .mockResolvedValueOnce(mockResponse(500, 'Internal Server Error'))
        .mockResolvedValueOnce(mockResponse(500, 'Internal Server Error'));

      await expect(client.rest('GET', '/api/3/issue/PROJ-1')).rejects.toThrow(
        'HTTP 500: Internal Server Error',
      );
    });

    it('retries on 5xx errors', async () => {
      const data = { id: '10001', key: 'PROJ-1' };
      fetchMock
        .mockResolvedValueOnce(mockResponse(500, 'Server Error'))
        .mockResolvedValueOnce(mockResponse(200, data));

      const result = await client.rest<typeof data>(
        'GET',
        '/api/3/issue/PROJ-1',
      );

      expect(result).toEqual(data);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('paginate', () => {
    it('fetches all pages using startAt/total', async () => {
      fetchMock
        .mockResolvedValueOnce(
          mockResponse(200, {
            startAt: 0,
            maxResults: 2,
            total: 5,
            issues: [{ id: '1' }, { id: '2' }],
          }),
        )
        .mockResolvedValueOnce(
          mockResponse(200, {
            startAt: 2,
            maxResults: 2,
            total: 5,
            issues: [{ id: '3' }, { id: '4' }],
          }),
        )
        .mockResolvedValueOnce(
          mockResponse(200, {
            startAt: 4,
            maxResults: 2,
            total: 5,
            issues: [{ id: '5' }],
          }),
        );

      const pages: Array<{ id: string }[]> = [];
      for await (const page of client.paginate<{ id: string }>(
        '/api/3/search?jql=project=PROJ',
      )) {
        pages.push(page);
      }

      expect(pages).toEqual([
        [{ id: '1' }, { id: '2' }],
        [{ id: '3' }, { id: '4' }],
        [{ id: '5' }],
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(3);

      // Check that startAt parameter is appended correctly (path already has ?)
      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('startAt=0&maxResults=50'),
        expect.any(Object),
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('startAt=2&maxResults=50'),
        expect.any(Object),
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        3,
        expect.stringContaining('startAt=4&maxResults=50'),
        expect.any(Object),
      );
    });

    it('handles empty results', async () => {
      fetchMock.mockResolvedValueOnce(
        mockResponse(200, {
          startAt: 0,
          maxResults: 50,
          total: 0,
          issues: [],
        }),
      );

      const pages: Array<{ id: string }[]> = [];
      for await (const page of client.paginate<{ id: string }>(
        '/api/3/search',
      )) {
        pages.push(page);
      }

      expect(pages).toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('uses & separator when path already contains ?', async () => {
      fetchMock.mockResolvedValueOnce(
        mockResponse(200, {
          startAt: 0,
          maxResults: 50,
          total: 1,
          issues: [{ id: '1' }],
        }),
      );

      const pages: Array<{ id: string }[]> = [];
      for await (const page of client.paginate<{ id: string }>(
        '/api/3/search?jql=project=PROJ',
      )) {
        pages.push(page);
      }

      expect(fetchMock).toHaveBeenCalledWith(
        'https://mysite.atlassian.net/rest/api/3/search?jql=project=PROJ&startAt=0&maxResults=50',
        expect.any(Object),
      );
    });

    it('uses ? separator when path has no query string', async () => {
      fetchMock.mockResolvedValueOnce(
        mockResponse(200, {
          startAt: 0,
          maxResults: 50,
          total: 1,
          issues: [{ id: '1' }],
        }),
      );

      const pages: Array<{ id: string }[]> = [];
      for await (const page of client.paginate<{ id: string }>(
        '/api/3/search',
      )) {
        pages.push(page);
      }

      expect(fetchMock).toHaveBeenCalledWith(
        'https://mysite.atlassian.net/rest/api/3/search?startAt=0&maxResults=50',
        expect.any(Object),
      );
    });
  });
});
