import {
  AuthError,
  BaseApiClient,
  DEFAULT_TIMEOUT_MS,
} from '../shared/api-client.js';

interface JiraSearchResponse<T> {
  startAt: number;
  maxResults: number;
  total: number;
  issues: T[];
}

interface JiraErrorResponse {
  errorMessages?: string[];
  errors?: Record<string, string>;
}

export class JiraApiClient extends BaseApiClient {
  private email: string;

  constructor(email: string, token: string, site: string) {
    super(token, `https://${site}/rest`);
    this.email = email;
  }

  private getAuthHeader(): string {
    return `Basic ${Buffer.from(`${this.email}:${this.token}`).toString('base64')}`;
  }

  protected override async fetch<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = this.baseUrl + path;

    const headers: Record<string, string> = {
      Authorization: this.getAuthHeader(),
      Accept: 'application/json',
    };

    const init: RequestInit = { method, headers };

    if (body !== undefined && ['POST', 'PATCH', 'PUT'].includes(method)) {
      headers['Content-Type'] = 'application/json';
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
        throw new Error('Request timed out', { cause: error });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 401) {
      throw new AuthError();
    }

    if (!response.ok) {
      // Try to parse Jira error format for readable messages
      try {
        const text = await response.text();
        const errorBody = JSON.parse(text) as JiraErrorResponse;
        const messages: string[] = [];
        if (errorBody.errorMessages?.length) {
          messages.push(...errorBody.errorMessages);
        }
        if (errorBody.errors) {
          for (const [field, msg] of Object.entries(errorBody.errors)) {
            messages.push(`${field}: ${msg}`);
          }
        }
        if (messages.length > 0) {
          throw new Error(`Jira API error: ${messages.join('; ')}`);
        }
      } catch (e) {
        if (e instanceof Error && e.message.startsWith('Jira API error:')) {
          throw e;
        }
      }

      throw new Error(`HTTP ${response.status}: Request failed`);
    }

    return (await response.json()) as T;
  }

  async rest<T>(method: string, path: string, body?: unknown): Promise<T> {
    return this.retry(() => this.fetch<T>(method, path, body));
  }

  async *paginate<T>(path: string): AsyncGenerator<T[]> {
    let startAt = 0;
    const separator = path.includes('?') ? '&' : '?';

    while (true) {
      const url = `${path}${separator}startAt=${startAt}&maxResults=50`;
      const response = await this.rest<JiraSearchResponse<T>>('GET', url);

      if (response.issues.length > 0) {
        yield response.issues;
      }

      startAt += response.issues.length;

      if (startAt >= response.total || response.issues.length === 0) {
        break;
      }
    }
  }
}
