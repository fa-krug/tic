import { BaseApiClient, AuthError } from '../shared/api-client.js';
import { getAdoRefreshToken, refreshAdoToken } from '../../auth/ado.js';

const ADO_API_VERSION = '7.1';

export type AdoAuth =
  | { type: 'bearer'; token: string }
  | { type: 'basic'; pat: string };

export class AdoApiClient extends BaseApiClient {
  private auth: AdoAuth;

  constructor(auth: AdoAuth, org: string) {
    const token = auth.type === 'bearer' ? auth.token : auth.pat;
    super(token, `https://dev.azure.com/${org}`);
    this.auth = auth;
  }

  private getAuthHeader(): string {
    if (this.auth.type === 'bearer') {
      return `Bearer ${this.auth.token}`;
    }
    return `Basic ${Buffer.from(`:${this.auth.pat}`).toString('base64')}`;
  }

  private appendApiVersion(path: string): string {
    const separator = path.includes('?') ? '&' : '?';
    return `${path}${separator}api-version=${ADO_API_VERSION}`;
  }

  protected override async fetch<T>(
    method: string,
    path: string,
    body?: unknown,
    contentType?: string,
  ): Promise<T> {
    const url = this.baseUrl + this.appendApiVersion(path);

    const headers: Record<string, string> = {
      Authorization: this.getAuthHeader(),
      Accept: 'application/json',
    };

    const init: RequestInit = { method, headers };

    if (body !== undefined && ['POST', 'PATCH', 'PUT'].includes(method)) {
      headers['Content-Type'] = contentType ?? 'application/json';
      init.body = JSON.stringify(body);
    }

    let response = await globalThis.fetch(url, init);

    this.checkRateLimit(response.headers);

    // Try token refresh on 401 for OAuth auth
    if (response.status === 401 && this.auth.type === 'bearer') {
      const refreshToken = getAdoRefreshToken();
      if (refreshToken) {
        const newToken = await refreshAdoToken(refreshToken);
        if (newToken) {
          this.auth = { type: 'bearer', token: newToken };
          this.token = newToken;
          headers['Authorization'] = `Bearer ${newToken}`;
          response = await globalThis.fetch(url, {
            method,
            headers,
            body: init.body,
          });
        }
      }
    }

    if (response.status === 401) {
      throw new AuthError();
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text}`);
    }

    return (await response.json()) as T;
  }

  async rest<T>(
    method: string,
    path: string,
    body?: unknown,
    contentType?: string,
  ): Promise<T> {
    return this.retry(() => this.fetch<T>(method, path, body, contentType));
  }

  async wiql<T>(project: string, query: string): Promise<T> {
    return this.rest<T>('POST', `/${project}/_apis/wit/wiql`, { query });
  }

  async batchGetWorkItems<T>(ids: number[]): Promise<T> {
    const CHUNK_SIZE = 200;
    const allValues: unknown[] = [];

    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
      const chunk = ids.slice(i, i + CHUNK_SIZE);
      const result = await this.rest<{ value: unknown[] }>(
        'POST',
        '/_apis/wit/workitemsbatch',
        { ids: chunk, $expand: 4 },
      );
      allValues.push(...result.value);
    }

    return { value: allValues } as T;
  }

  async *paginate<T>(path: string): AsyncGenerator<T[]> {
    let url: string | null = this.baseUrl + this.appendApiVersion(path);

    while (url) {
      const headers: Record<string, string> = {
        Authorization: this.getAuthHeader(),
        Accept: 'application/json',
      };

      const response: Response = await globalThis.fetch(url, {
        method: 'GET',
        headers,
      });

      this.checkRateLimit(response.headers);

      if (response.status === 401) {
        throw new AuthError();
      }

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text}`);
      }

      const json = (await response.json()) as { value: T[]; count?: number };
      yield json.value;

      const continuationToken: string | null = response.headers.get(
        'x-ms-continuationtoken',
      );
      if (continuationToken) {
        const separator = path.includes('?') ? '&' : '?';
        url =
          this.baseUrl +
          this.appendApiVersion(
            `${path}${separator}continuationToken=${continuationToken}`,
          );
      } else {
        url = null;
      }
    }
  }
}
