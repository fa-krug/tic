import { AuthError, BaseApiClient } from '../shared/api-client.js';

const GITHUB_API_VERSION = '2022-11-28';

export class GitHubApiClient extends BaseApiClient {
  constructor(token: string) {
    super(token, 'https://api.github.com');
  }

  protected override async fetch<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = this.baseUrl + path;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/json',
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
    };

    const init: RequestInit = { method, headers };

    if (body !== undefined && ['POST', 'PATCH', 'PUT'].includes(method)) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    const response = await globalThis.fetch(url, init);

    this.checkRateLimit(response.headers);

    if (response.status === 401) {
      throw new AuthError();
    }

    if (response.status === 403) {
      const remaining = response.headers.get('X-RateLimit-Remaining');
      const reset = response.headers.get('X-RateLimit-Reset');
      if (remaining === '0' && reset) {
        const { RateLimitError } = await import('../shared/api-client.js');
        throw new RateLimitError(new Date(Number(reset) * 1000));
      }
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text}`);
    }

    return (await response.json()) as T;
  }

  async rest<T>(method: string, path: string, body?: unknown): Promise<T> {
    return this.retry(() => this.fetch<T>(method, path, body));
  }

  async graphql<T>(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<T> {
    const url = this.baseUrl + '/graphql';

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
      'GraphQL-Features': 'sub_issues',
    };

    const response = await globalThis.fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, variables }),
    });

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

  async *paginate<T>(path: string): AsyncGenerator<T[]> {
    let url: string | null = this.baseUrl + path;

    while (url) {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/json',
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
      };

      const response = await globalThis.fetch(url, {
        method: 'GET',
        headers,
      });

      this.checkRateLimit(response.headers);

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text}`);
      }

      const data = (await response.json()) as T[];
      yield data;

      const linkHeader = response.headers.get('Link');
      url = parseLinkNext(linkHeader);
    }
  }
}

function parseLinkNext(linkHeader: string | null): string | null {
  if (!linkHeader) return null;

  const parts = linkHeader.split(',');
  for (const part of parts) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}
