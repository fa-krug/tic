import {
  AuthError,
  BaseApiClient,
  DEFAULT_TIMEOUT_MS,
} from '../shared/api-client.js';

export interface Connection<T> {
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

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    let response: Response;
    try {
      response = await globalThis.fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      });
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error('Request timed out');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    this.checkRateLimit(response.headers);

    if (response.status === 401) {
      throw new AuthError();
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: Request failed`);
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

  async uploadFile(
    projectId: string,
    data: Buffer,
    filename: string,
  ): Promise<{ url: string; markdown: string }> {
    return this.retry(async () => {
      const encodedId = encodeURIComponent(projectId);
      const url = `${this.baseUrl}/api/v4/projects/${encodedId}/uploads`;

      const formData = new FormData();
      formData.append('file', new Blob([new Uint8Array(data)]), filename);

      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.token}`,
      };

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

      let response: Response;
      try {
        response = await globalThis.fetch(url, {
          method: 'POST',
          headers,
          body: formData,
          signal: controller.signal,
        });
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          throw new Error('Request timed out');
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }

      this.checkRateLimit(response.headers);

      if (response.status === 401) {
        throw new AuthError();
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: Upload failed`);
      }

      const json = (await response.json()) as {
        alt: string;
        url: string;
        full_path: string;
        markdown: string;
      };

      return { url: json.full_path, markdown: json.markdown };
    });
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
