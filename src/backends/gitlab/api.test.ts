import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitLabApiClient } from './api.js';
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

describe('GitLabApiClient', () => {
  let client: GitLabApiClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    client = new GitLabApiClient('glpat-test-token');
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof globalThis.fetch;
  });

  describe('graphql', () => {
    it('sends POST to /api/graphql with correct URL and headers', async () => {
      const query = '{ currentUser { username } }';
      const responseData = { currentUser: { username: 'testuser' } };
      fetchMock.mockResolvedValue(mockResponse(200, { data: responseData }));

      await client.graphql(query);

      expect(fetchMock).toHaveBeenCalledWith('https://gitlab.com/api/graphql', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer glpat-test-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, variables: undefined }),
      });
    });

    it('passes variables in the request body', async () => {
      const query =
        'query($fullPath: ID!) { project(fullPath: $fullPath) { name } }';
      const variables = { fullPath: 'group/project' };
      fetchMock.mockResolvedValue(
        mockResponse(200, { data: { project: { name: 'test-project' } } }),
      );

      await client.graphql(query, variables);

      expect(fetchMock).toHaveBeenCalledWith(
        'https://gitlab.com/api/graphql',
        expect.objectContaining({
          body: JSON.stringify({ query, variables }),
        }),
      );
    });

    it('returns data from the response', async () => {
      const query = '{ currentUser { username } }';
      const responseData = { currentUser: { username: 'testuser' } };
      fetchMock.mockResolvedValue(mockResponse(200, { data: responseData }));

      const result = await client.graphql<typeof responseData>(query);

      expect(result).toEqual(responseData);
    });

    it('throws AuthError on 401', async () => {
      const query = '{ currentUser { username } }';
      fetchMock.mockResolvedValue(mockResponse(401, 'Unauthorized'));

      await expect(client.graphql(query)).rejects.toThrow(AuthError);
    });

    it('throws on GraphQL errors array', async () => {
      const query = '{ invalid }';
      fetchMock.mockResolvedValue(
        mockResponse(200, {
          errors: [{ message: 'Field "invalid" not found on type "Query"' }],
        }),
      );

      await expect(client.graphql(query)).rejects.toThrow(
        'GraphQL error: Field "invalid" not found on type "Query"',
      );
    });

    it('retries on 5xx errors', async () => {
      const query = '{ currentUser { username } }';
      const responseData = { currentUser: { username: 'testuser' } };

      fetchMock
        .mockResolvedValueOnce(mockResponse(500, 'Internal Server Error'))
        .mockResolvedValueOnce(mockResponse(200, { data: responseData }));

      const result = await client.graphql<typeof responseData>(query);

      expect(result).toEqual(responseData);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('paginate', () => {
    interface WorkItemNode {
      id: string;
      title: string;
    }

    interface WorkItemsConnection {
      nodes: WorkItemNode[];
      pageInfo: {
        hasNextPage: boolean;
        endCursor: string | null;
      };
    }

    interface ProjectResponse {
      project: {
        workItems: WorkItemsConnection;
      };
    }

    const query = `query($fullPath: ID!, $cursor: String) {
      project(fullPath: $fullPath) {
        workItems(after: $cursor) {
          nodes { id title }
          pageInfo { hasNextPage endCursor }
        }
      }
    }`;

    const extractConnection = (data: unknown) =>
      (data as ProjectResponse).project.workItems;

    it('paginates through multiple pages using cursor', async () => {
      const page1Response: ProjectResponse = {
        project: {
          workItems: {
            nodes: [
              { id: 'gid://1', title: 'Item 1' },
              { id: 'gid://2', title: 'Item 2' },
            ],
            pageInfo: { hasNextPage: true, endCursor: 'cursor-1' },
          },
        },
      };

      const page2Response: ProjectResponse = {
        project: {
          workItems: {
            nodes: [
              { id: 'gid://3', title: 'Item 3' },
              { id: 'gid://4', title: 'Item 4' },
            ],
            pageInfo: { hasNextPage: true, endCursor: 'cursor-2' },
          },
        },
      };

      const page3Response: ProjectResponse = {
        project: {
          workItems: {
            nodes: [{ id: 'gid://5', title: 'Item 5' }],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      };

      fetchMock
        .mockResolvedValueOnce(mockResponse(200, { data: page1Response }))
        .mockResolvedValueOnce(mockResponse(200, { data: page2Response }))
        .mockResolvedValueOnce(mockResponse(200, { data: page3Response }));

      const allNodes: WorkItemNode[] = [];
      for await (const page of client.paginate<WorkItemNode>(
        query,
        { fullPath: 'group/project' },
        extractConnection,
      )) {
        allNodes.push(...page);
      }

      expect(allNodes).toEqual([
        { id: 'gid://1', title: 'Item 1' },
        { id: 'gid://2', title: 'Item 2' },
        { id: 'gid://3', title: 'Item 3' },
        { id: 'gid://4', title: 'Item 4' },
        { id: 'gid://5', title: 'Item 5' },
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(3);

      // First call should have no cursor
      const firstCallInit = fetchMock.mock.calls[0]![1] as RequestInit;
      const firstCallBody = JSON.parse(firstCallInit.body as string) as {
        variables: Record<string, unknown>;
      };
      expect(firstCallBody.variables).toEqual({
        fullPath: 'group/project',
        cursor: null,
      });

      // Second call should have cursor from first page
      const secondCallInit = fetchMock.mock.calls[1]![1] as RequestInit;
      const secondCallBody = JSON.parse(secondCallInit.body as string) as {
        variables: Record<string, unknown>;
      };
      expect(secondCallBody.variables).toEqual({
        fullPath: 'group/project',
        cursor: 'cursor-1',
      });

      // Third call should have cursor from second page
      const thirdCallInit = fetchMock.mock.calls[2]![1] as RequestInit;
      const thirdCallBody = JSON.parse(thirdCallInit.body as string) as {
        variables: Record<string, unknown>;
      };
      expect(thirdCallBody.variables).toEqual({
        fullPath: 'group/project',
        cursor: 'cursor-2',
      });
    });

    it('yields single page when hasNextPage is false', async () => {
      const response: ProjectResponse = {
        project: {
          workItems: {
            nodes: [
              { id: 'gid://1', title: 'Item 1' },
              { id: 'gid://2', title: 'Item 2' },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      };

      fetchMock.mockResolvedValue(mockResponse(200, { data: response }));

      const allNodes: WorkItemNode[] = [];
      for await (const page of client.paginate<WorkItemNode>(
        query,
        { fullPath: 'group/project' },
        extractConnection,
      )) {
        allNodes.push(...page);
      }

      expect(allNodes).toEqual([
        { id: 'gid://1', title: 'Item 1' },
        { id: 'gid://2', title: 'Item 2' },
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('uses extractConnection callback to find the connection in response data', async () => {
      interface IssuesResponse {
        group: {
          issues: WorkItemsConnection;
        };
      }

      const response: IssuesResponse = {
        group: {
          issues: {
            nodes: [{ id: 'gid://10', title: 'Issue 10' }],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      };

      fetchMock.mockResolvedValue(mockResponse(200, { data: response }));

      const differentExtract = (data: unknown) =>
        (data as IssuesResponse).group.issues;

      const allNodes: WorkItemNode[] = [];
      for await (const page of client.paginate<WorkItemNode>(
        'query { group { issues { nodes { id title } pageInfo { hasNextPage endCursor } } } }',
        {},
        differentExtract,
      )) {
        allNodes.push(...page);
      }

      expect(allNodes).toEqual([{ id: 'gid://10', title: 'Issue 10' }]);
    });
  });
});
