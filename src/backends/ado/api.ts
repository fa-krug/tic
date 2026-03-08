import {
  BaseApiClient,
  AuthError,
  DEFAULT_TIMEOUT_MS,
} from '../shared/api-client.js';
import { getAdoRefreshToken, refreshAdoToken } from '../../auth/ado.js';

const ADO_API_VERSION = '7.1';

export type AdoAuth =
  | { type: 'bearer'; token: string }
  | { type: 'basic'; pat: string };

export class AdoApiClient extends BaseApiClient {
  private auth: AdoAuth;
  private refreshPromise: Promise<string | null> | null = null;

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

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    let response: Response;
    try {
      response = await globalThis.fetch(url, {
        ...init,
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

    // Try token refresh on 401 for OAuth auth
    if (response.status === 401 && this.auth.type === 'bearer') {
      const refreshToken = getAdoRefreshToken();
      if (refreshToken) {
        if (!this.refreshPromise) {
          this.refreshPromise = refreshAdoToken(refreshToken).finally(() => {
            this.refreshPromise = null;
          });
        }
        const newToken = await this.refreshPromise;
        if (newToken) {
          this.auth = { type: 'bearer', token: newToken };
          this.token = newToken;
          headers['Authorization'] = `Bearer ${newToken}`;

          const retryController = new AbortController();
          const retryTimeout = setTimeout(
            () => retryController.abort(),
            DEFAULT_TIMEOUT_MS,
          );

          try {
            response = await globalThis.fetch(url, {
              method,
              headers,
              body: init.body,
              signal: retryController.signal,
            });
          } catch (error: unknown) {
            if (error instanceof DOMException && error.name === 'AbortError') {
              throw new Error('Request timed out');
            }
            throw error;
          } finally {
            clearTimeout(retryTimeout);
          }
        }
      }
    }

    if (response.status === 401) {
      throw new AuthError();
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: Request failed`);
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

  async uploadAttachment(
    project: string,
    data: Buffer,
    filename: string,
  ): Promise<string> {
    return this.retry(async () => {
      const path = `/${project}/_apis/wit/attachments?fileName=${encodeURIComponent(filename)}&api-version=${ADO_API_VERSION}`;
      const url = this.baseUrl + path;

      const headers: Record<string, string> = {
        Authorization: this.getAuthHeader(),
        'Content-Type': 'application/octet-stream',
      };

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

      let response: Response;
      try {
        response = await globalThis.fetch(url, {
          method: 'POST',
          headers,
          body: new Uint8Array(data),
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

      const json = (await response.json()) as { url: string };
      return json.url;
    });
  }

  async *paginate<T>(path: string): AsyncGenerator<T[]> {
    let url: string | null = this.baseUrl + this.appendApiVersion(path);

    while (url) {
      const headers: Record<string, string> = {
        Authorization: this.getAuthHeader(),
        Accept: 'application/json',
      };

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

      let response: Response;
      try {
        response = await globalThis.fetch(url, {
          method: 'GET',
          headers,
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
