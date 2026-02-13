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
      'api-token-123',
      'mysite.atlassian.net',
    );
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof globalThis.fetch;
  });

  describe('rest', () => {
    it('sends Basic auth header with base64-encoded email:token', async () => {
      const data = { id: '10001', key: 'PROJ-1' };
      fetchMock.mockResolvedValue(mockResponse(200, data));

      const result = await client.rest<typeof data>('GET', '/issue/PROJ-1');

      const expectedAuth = `Basic ${Buffer.from('user@example.com:api-token-123').toString('base64')}`;
      expect(fetchMock).toHaveBeenCalledWith(
        'https://mysite.atlassian.net/rest/issue/PROJ-1',
        {
          method: 'GET',
          headers: {
            Authorization: expectedAuth,
            Accept: 'application/json',
          },
        },
      );
      expect(result).toEqual(data);
    });

    it('sends JSON body on POST', async () => {
      const body = { fields: { summary: 'New issue', description: 'Details' } };
      const data = { id: '10002', key: 'PROJ-2' };
      fetchMock.mockResolvedValue(mockResponse(201, data));

      await client.rest('POST', '/issue', body);

      const expectedAuth = `Basic ${Buffer.from('user@example.com:api-token-123').toString('base64')}`;
      expect(fetchMock).toHaveBeenCalledWith(
        'https://mysite.atlassian.net/rest/issue',
        {
          method: 'POST',
          headers: {
            Authorization: expectedAuth,
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        },
      );
    });

    it('throws AuthError on 401', async () => {
      fetchMock.mockResolvedValue(mockResponse(401, 'Unauthorized'));

      await expect(client.rest('GET', '/issue/PROJ-1')).rejects.toThrow(
        AuthError,
      );
    });

    it('throws on non-ok response with Jira error body (errorMessages parsed)', async () => {
      const errorBody = {
        errorMessages: [
          'Issue does not exist or you do not have permission to see it.',
        ],
        errors: {},
      };
      fetchMock.mockResolvedValue(mockResponse(404, errorBody));

      await expect(client.rest('GET', '/issue/PROJ-999')).rejects.toThrow(
        'Issue does not exist or you do not have permission to see it.',
      );
    });

    it('throws with field errors from Jira error body', async () => {
      const errorBody = {
        errorMessages: [],
        errors: {
          summary: 'Summary is required',
          priority: 'Priority is required',
        },
      };
      fetchMock.mockResolvedValue(mockResponse(400, errorBody));

      await expect(
        client.rest('POST', '/issue', { fields: {} }),
      ).rejects.toThrow(
        'summary: Summary is required; priority: Priority is required',
      );
    });

    it('retries on 5xx errors', async () => {
      fetchMock
        .mockResolvedValueOnce(mockResponse(502, 'Bad Gateway'))
        .mockResolvedValueOnce(mockResponse(200, { id: '10001' }));

      const result = await client.rest<{ id: string }>('GET', '/issue/PROJ-1');

      expect(result).toEqual({ id: '10001' });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('handles DELETE returning 204 with no body', async () => {
      const response = {
        ok: true,
        status: 204,
        headers: new Headers(),
        json: vi.fn().mockRejectedValue(new Error('No body')),
        text: vi.fn().mockResolvedValue(''),
      } as unknown as Response;
      fetchMock.mockResolvedValue(response);

      const result = await client.rest('DELETE', '/issue/PROJ-1');

      expect(result).toBeUndefined();
    });
  });

  describe('paginate', () => {
    it('fetches all pages using startAt + total', async () => {
      const page1 = {
        startAt: 0,
        maxResults: 2,
        total: 5,
        issues: [{ id: '1' }, { id: '2' }],
      };
      const page2 = {
        startAt: 2,
        maxResults: 2,
        total: 5,
        issues: [{ id: '3' }, { id: '4' }],
      };
      const page3 = {
        startAt: 4,
        maxResults: 2,
        total: 5,
        issues: [{ id: '5' }],
      };

      fetchMock
        .mockResolvedValueOnce(mockResponse(200, page1))
        .mockResolvedValueOnce(mockResponse(200, page2))
        .mockResolvedValueOnce(mockResponse(200, page3));

      const pages: Array<{ id: string }[]> = [];
      for await (const page of client.paginate<{ id: string }>('/search')) {
        pages.push(page);
      }

      expect(pages).toEqual([
        [{ id: '1' }, { id: '2' }],
        [{ id: '3' }, { id: '4' }],
        [{ id: '5' }],
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(3);

      // Verify pagination query params
      const expectedAuth = `Basic ${Buffer.from('user@example.com:api-token-123').toString('base64')}`;
      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        'https://mysite.atlassian.net/rest/search?startAt=0',
        {
          method: 'GET',
          headers: {
            Authorization: expectedAuth,
            Accept: 'application/json',
          },
        },
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        'https://mysite.atlassian.net/rest/search?startAt=2',
        expect.objectContaining({ method: 'GET' }),
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        3,
        'https://mysite.atlassian.net/rest/search?startAt=4',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('handles empty results', async () => {
      const emptyResponse = {
        startAt: 0,
        maxResults: 50,
        total: 0,
        issues: [],
      };
      fetchMock.mockResolvedValue(mockResponse(200, emptyResponse));

      const pages: Array<{ id: string }[]> = [];
      for await (const page of client.paginate<{ id: string }>('/search')) {
        pages.push(page);
      }

      expect(pages).toEqual([[]]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('handles path with existing query parameters', async () => {
      const response = {
        startAt: 0,
        maxResults: 50,
        total: 1,
        issues: [{ id: '1' }],
      };
      fetchMock.mockResolvedValue(mockResponse(200, response));

      const pages: Array<{ id: string }[]> = [];
      for await (const page of client.paginate<{ id: string }>(
        '/search?jql=project=PROJ',
      )) {
        pages.push(page);
      }

      expect(fetchMock).toHaveBeenCalledWith(
        'https://mysite.atlassian.net/rest/search?jql=project=PROJ&startAt=0',
        expect.objectContaining({ method: 'GET' }),
      );
    });
  });
});
