import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubApiClient } from './api.js';
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

describe('GitHubApiClient', () => {
  let client: GitHubApiClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    client = new GitHubApiClient('gh-token-123');
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof globalThis.fetch;
  });

  describe('rest', () => {
    it('sends GitHub-specific headers (X-GitHub-Api-Version)', async () => {
      const data = { id: 1, title: 'Issue' };
      fetchMock.mockResolvedValue(mockResponse(200, data));

      const result = await client.rest<typeof data>(
        'GET',
        '/repos/owner/repo/issues',
      );

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.github.com/repos/owner/repo/issues',
        expect.objectContaining({
          method: 'GET',
          headers: {
            Authorization: 'Bearer gh-token-123',
            Accept: 'application/json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
          signal: expect.any(AbortSignal) as unknown,
        }),
      );
      expect(result).toEqual(data);
    });

    it('sends JSON body on POST', async () => {
      const body = { title: 'New issue', body: 'Description' };
      const data = { id: 1, ...body };
      fetchMock.mockResolvedValue(mockResponse(200, data));

      await client.rest('POST', '/repos/owner/repo/issues', body);

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.github.com/repos/owner/repo/issues',
        expect.objectContaining({
          method: 'POST',
          headers: {
            Authorization: 'Bearer gh-token-123',
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
          body: JSON.stringify(body),
          signal: expect.any(AbortSignal) as unknown,
        }),
      );
    });

    it('throws AuthError on 401', async () => {
      fetchMock.mockResolvedValue(mockResponse(401, 'Unauthorized'));

      await expect(
        client.rest('GET', '/repos/owner/repo/issues'),
      ).rejects.toThrow(AuthError);
    });
  });

  describe('graphql', () => {
    it('sends to /graphql endpoint with correct headers (GraphQL-Features: sub_issues)', async () => {
      const query = '{ viewer { login } }';
      const responseData = { viewer: { login: 'testuser' } };
      fetchMock.mockResolvedValue(mockResponse(200, { data: responseData }));

      await client.graphql(query);

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.github.com/graphql',
        expect.objectContaining({
          method: 'POST',
          headers: {
            Authorization: 'Bearer gh-token-123',
            'Content-Type': 'application/json',
            'X-GitHub-Api-Version': '2022-11-28',
            'GraphQL-Features': 'sub_issues',
          },
          body: JSON.stringify({ query, variables: undefined }),
          signal: expect.any(AbortSignal) as unknown,
        }),
      );
    });

    it('passes variables in body', async () => {
      const query =
        'query($owner: String!) { repository(owner: $owner) { name } }';
      const variables = { owner: 'testowner' };
      fetchMock.mockResolvedValue(
        mockResponse(200, { data: { repository: { name: 'testrepo' } } }),
      );

      await client.graphql(query, variables);

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.github.com/graphql',
        expect.objectContaining({
          body: JSON.stringify({ query, variables }),
        }),
      );
    });

    it('returns data from response', async () => {
      const query = '{ viewer { login } }';
      const responseData = { viewer: { login: 'testuser' } };
      fetchMock.mockResolvedValue(mockResponse(200, { data: responseData }));

      const result = await client.graphql<typeof responseData>(query);

      expect(result).toEqual(responseData);
    });

    it('throws on GraphQL errors array', async () => {
      const query = '{ invalid }';
      fetchMock.mockResolvedValue(
        mockResponse(200, {
          errors: [{ message: 'Field "invalid" not found' }],
        }),
      );

      await expect(client.graphql(query)).rejects.toThrow(
        'GraphQL error: Field "invalid" not found',
      );
    });

    it('throws AuthError on 401', async () => {
      const query = '{ viewer { login } }';
      fetchMock.mockResolvedValue(mockResponse(401, 'Unauthorized'));

      await expect(client.graphql(query)).rejects.toThrow(AuthError);
    });
  });

  describe('paginate', () => {
    it('follows Link header pagination across multiple pages', async () => {
      const page1 = [{ id: 1 }, { id: 2 }];
      const page2 = [{ id: 3 }, { id: 4 }];
      const page3 = [{ id: 5 }];

      fetchMock
        .mockResolvedValueOnce(
          mockResponse(200, page1, {
            Link: '<https://api.github.com/repos/owner/repo/issues?page=2>; rel="next", <https://api.github.com/repos/owner/repo/issues?page=3>; rel="last"',
          }),
        )
        .mockResolvedValueOnce(
          mockResponse(200, page2, {
            Link: '<https://api.github.com/repos/owner/repo/issues?page=3>; rel="next", <https://api.github.com/repos/owner/repo/issues?page=3>; rel="last"',
          }),
        )
        .mockResolvedValueOnce(mockResponse(200, page3));

      const pages: Array<{ id: number }[]> = [];
      for await (const page of client.paginate<{ id: number }>(
        '/repos/owner/repo/issues',
      )) {
        pages.push(page);
      }

      expect(pages).toEqual([page1, page2, page3]);
      expect(fetchMock).toHaveBeenCalledTimes(3);

      // Second call should use the absolute URL from Link header
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        'https://api.github.com/repos/owner/repo/issues?page=2',
        expect.objectContaining({ method: 'GET' }),
      );

      // Third call should use the absolute URL from second Link header
      expect(fetchMock).toHaveBeenNthCalledWith(
        3,
        'https://api.github.com/repos/owner/repo/issues?page=3',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('yields single page when no Link header', async () => {
      const data = [{ id: 1 }, { id: 2 }];
      fetchMock.mockResolvedValue(mockResponse(200, data));

      const pages: Array<{ id: number }[]> = [];
      for await (const page of client.paginate<{ id: number }>(
        '/repos/owner/repo/collaborators',
      )) {
        pages.push(page);
      }

      expect(pages).toEqual([data]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('sends auth and GitHub headers on each page request', async () => {
      const page1 = [{ id: 1 }];
      const page2 = [{ id: 2 }];

      fetchMock
        .mockResolvedValueOnce(
          mockResponse(200, page1, {
            Link: '<https://api.github.com/repos/owner/repo/issues?page=2>; rel="next"',
          }),
        )
        .mockResolvedValueOnce(mockResponse(200, page2));

      const pages: Array<{ id: number }[]> = [];
      for await (const page of client.paginate<{ id: number }>(
        '/repos/owner/repo/issues',
      )) {
        pages.push(page);
      }

      const expectedHeaders = {
        Authorization: 'Bearer gh-token-123',
        Accept: 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      };

      // First request
      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        'https://api.github.com/repos/owner/repo/issues',
        expect.objectContaining({
          method: 'GET',
          headers: expectedHeaders,
          signal: expect.any(AbortSignal) as unknown,
        }),
      );

      // Second request (paginated)
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        'https://api.github.com/repos/owner/repo/issues?page=2',
        expect.objectContaining({
          method: 'GET',
          headers: expectedHeaders,
          signal: expect.any(AbortSignal) as unknown,
        }),
      );
    });
  });
});
