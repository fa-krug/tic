import { AuthError, BaseApiClient } from '../shared/api-client.js';

interface Connection<T> {
  nodes: T[];
  pageInfo: {
    hasNextPage: boolean;
    endCursor: string | null;
  };
}

export class GitLabApiClient extends BaseApiClient {
  constructor(token: string) {
    super(token, 'https://gitlab.com');
  }

  async graphql<T>(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<T> {
    return this.retry(() => this.graphqlFetch<T>(query, variables));
  }

  private async graphqlFetch<T>(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<T> {
    const url = this.baseUrl + '/api/graphql';

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };

    const response = await globalThis.fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, variables }),
    });

    this.checkRateLimit(response.headers);

    if (response.status === 401) {
      throw new AuthError();
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text}`);
    }

    const json = (await response.json()) as {
      data?: T;
      errors?: Array<{ message: string }>;
    };

    const firstError = json.errors?.[0];
    if (firstError) {
      throw new Error(`GraphQL error: ${firstError.message}`);
    }

    return json.data as T;
  }

  async *paginate<T>(
    query: string,
    variables?: Record<string, unknown>,
    extractConnection?: (data: unknown) => Connection<T>,
  ): AsyncGenerator<T[]> {
    if (!extractConnection) {
      throw new Error(
        'GitLabApiClient.paginate requires variables and extractConnection arguments',
      );
    }

    let cursor: string | null = null;
    let hasNextPage = true;

    while (hasNextPage) {
      const data = await this.graphql<unknown>(query, {
        ...variables,
        cursor,
      });

      const connection = extractConnection(data);
      yield connection.nodes;

      hasNextPage = connection.pageInfo.hasNextPage;
      cursor = connection.pageInfo.endCursor;
    }
  }
}
