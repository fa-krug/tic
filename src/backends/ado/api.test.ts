import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdoApiClient } from './api.js';
import { AuthError } from '../shared/api-client.js';
import { getAdoRefreshToken, refreshAdoToken } from '../../auth/ado.js';

vi.mock('../../auth/ado.js', () => ({
  getAdoRefreshToken: vi.fn(),
  refreshAdoToken: vi.fn(),
}));

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

describe('AdoApiClient', () => {
  let client: AdoApiClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    client = new AdoApiClient(
      { type: 'bearer', token: 'ado-token-123' },
      'contoso',
    );
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof globalThis.fetch;
  });

  describe('rest', () => {
    it('sends Bearer auth and api-version query param', async () => {
      const data = { id: 1, name: 'Bug' };
      fetchMock.mockResolvedValue(mockResponse(200, data));

      const result = await client.rest<typeof data>(
        'GET',
        '/MyProject/_apis/wit/workitems/1',
      );

      expect(fetchMock).toHaveBeenCalledWith(
        'https://dev.azure.com/contoso/MyProject/_apis/wit/workitems/1?api-version=7.1',
        expect.objectContaining({
          method: 'GET',
          headers: {
            Authorization: 'Bearer ado-token-123',
            Accept: 'application/json',
          },
          signal: expect.any(AbortSignal) as unknown,
        }),
      );
      expect(result).toEqual(data);
    });

    it('sends Basic auth when using PAT', async () => {
      const patClient = new AdoApiClient(
        { type: 'basic', pat: 'my-pat-token' },
        'contoso',
      );
      fetchMock.mockResolvedValue(mockResponse(200, { ok: true }));

      await patClient.rest('GET', '/MyProject/_apis/wit/workitems/1');

      const expectedAuth =
        'Basic ' + Buffer.from(':my-pat-token').toString('base64');
      const callArgs = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(callArgs[1].headers).toEqual(
        expect.objectContaining({
          Authorization: expectedAuth,
        }),
      );
    });

    it('sends JSON Patch body with correct content type', async () => {
      const patch = [
        { op: 'add', path: '/fields/System.Title', value: 'Bug fix' },
      ];
      fetchMock.mockResolvedValue(mockResponse(200, { id: 1 }));

      await client.rest(
        'PATCH',
        '/_apis/wit/workitems/1',
        patch,
        'application/json-patch+json',
      );

      const callArgs = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(callArgs[1].method).toBe('PATCH');
      expect(callArgs[1].headers).toEqual(
        expect.objectContaining({
          'Content-Type': 'application/json-patch+json',
        }),
      );
      expect(callArgs[1].body).toBe(JSON.stringify(patch));
    });

    it('appends api-version to URLs that already have query params', async () => {
      fetchMock.mockResolvedValue(mockResponse(200, {}));

      await client.rest(
        'GET',
        '/project/_apis/wit/workitems/1?$expand=relations',
      );

      expect(fetchMock).toHaveBeenCalledWith(
        'https://dev.azure.com/contoso/project/_apis/wit/workitems/1?$expand=relations&api-version=7.1',
        expect.any(Object),
      );
    });

    it('throws AuthError on 401', async () => {
      fetchMock.mockResolvedValue(mockResponse(401, 'Unauthorized'));

      await expect(
        client.rest('GET', '/_apis/wit/workitems/1'),
      ).rejects.toThrow(AuthError);
    });

    it('retries on 5xx', async () => {
      fetchMock
        .mockResolvedValueOnce(mockResponse(500, 'Server Error'))
        .mockResolvedValueOnce(mockResponse(200, { id: 1 }));

      const result = await client.rest<{ id: number }>(
        'GET',
        '/_apis/wit/workitems/1',
      );

      expect(result).toEqual({ id: 1 });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('wiql', () => {
    it('posts WIQL query and returns work item references', async () => {
      const wiqlResult = {
        workItems: [{ id: 1 }, { id: 2 }, { id: 3 }],
      };
      fetchMock.mockResolvedValue(mockResponse(200, wiqlResult));

      const result = await client.wiql(
        'MyProject',
        "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = 'MyProject'",
      );

      expect(fetchMock).toHaveBeenCalledWith(
        'https://dev.azure.com/contoso/MyProject/_apis/wit/wiql?api-version=7.1',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            query:
              "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = 'MyProject'",
          }),
        }),
      );
      expect(result).toEqual(wiqlResult);
    });
  });

  describe('batchGetWorkItems', () => {
    it('posts batch request with IDs', async () => {
      const batchResult = {
        value: [
          { id: 1, fields: {} },
          { id: 2, fields: {} },
        ],
      };
      fetchMock.mockResolvedValue(mockResponse(200, batchResult));

      const result = await client.batchGetWorkItems([1, 2]);

      expect(fetchMock).toHaveBeenCalledWith(
        'https://dev.azure.com/contoso/_apis/wit/workitemsbatch?api-version=7.1',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ ids: [1, 2], $expand: 4 }),
        }),
      );
      expect(result).toEqual(batchResult);
    });

    it('chunks large batches into groups of 200', async () => {
      const ids = Array.from({ length: 450 }, (_, i) => i + 1);
      fetchMock
        .mockResolvedValueOnce(mockResponse(200, { value: [] }))
        .mockResolvedValueOnce(mockResponse(200, { value: [] }))
        .mockResolvedValueOnce(mockResponse(200, { value: [] }));

      await client.batchGetWorkItems(ids);

      expect(fetchMock).toHaveBeenCalledTimes(3);
      // First chunk: 200 items
      const call0 = fetchMock.mock.calls[0] as [string, RequestInit];
      const firstBody = JSON.parse(call0[1].body as string) as {
        ids: number[];
      };
      expect(firstBody.ids).toHaveLength(200);
      // Second chunk: 200 items
      const call1 = fetchMock.mock.calls[1] as [string, RequestInit];
      const secondBody = JSON.parse(call1[1].body as string) as {
        ids: number[];
      };
      expect(secondBody.ids).toHaveLength(200);
      // Third chunk: 50 items
      const call2 = fetchMock.mock.calls[2] as [string, RequestInit];
      const thirdBody = JSON.parse(call2[1].body as string) as {
        ids: number[];
      };
      expect(thirdBody.ids).toHaveLength(50);
    });
  });

  describe('token refresh mutex', () => {
    it('calls refreshAdoToken only once for concurrent 401 responses', async () => {
      const getRefresh = vi.mocked(getAdoRefreshToken);
      const refresh = vi.mocked(refreshAdoToken);

      getRefresh.mockReturnValue('refresh-token-123');
      refresh.mockResolvedValue('new-access-token');

      // First two calls (one per concurrent request) return 401, retries succeed
      fetchMock
        .mockResolvedValueOnce(mockResponse(401, 'Unauthorized'))
        .mockResolvedValueOnce(mockResponse(401, 'Unauthorized'))
        .mockResolvedValue(mockResponse(200, { id: 1 }));

      const [result1, result2] = await Promise.all([
        client.rest<{ id: number }>('GET', '/_apis/wit/workitems/1'),
        client.rest<{ id: number }>('GET', '/_apis/wit/workitems/2'),
      ]);

      expect(result1).toEqual({ id: 1 });
      expect(result2).toEqual({ id: 1 });
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(refresh).toHaveBeenCalledWith('refresh-token-123');
    });
  });

  describe('paginate', () => {
    it('follows continuationToken across pages', async () => {
      fetchMock
        .mockResolvedValueOnce(
          mockResponse(
            200,
            { value: [{ id: 1 }], count: 1 },
            { 'x-ms-continuationtoken': 'token1' },
          ),
        )
        .mockResolvedValueOnce(
          mockResponse(200, { value: [{ id: 2 }], count: 1 }),
        );

      const pages: Array<{ id: number }[]> = [];
      for await (const page of client.paginate<{ id: number }>(
        '/MyProject/_apis/work/teamsettings/iterations',
      )) {
        pages.push(page);
      }

      expect(pages).toEqual([[{ id: 1 }], [{ id: 2 }]]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('yields single page when no continuationToken', async () => {
      fetchMock.mockResolvedValue(
        mockResponse(200, { value: [{ id: 1 }, { id: 2 }], count: 2 }),
      );

      const pages: Array<{ id: number }[]> = [];
      for await (const page of client.paginate<{ id: number }>(
        '/MyProject/_apis/wit/workitemtypes',
      )) {
        pages.push(page);
      }

      expect(pages).toEqual([[{ id: 1 }, { id: 2 }]]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
