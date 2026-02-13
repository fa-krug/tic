import { BaseApiClient, AuthError } from '../shared/api-client.js';

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

    const response = await globalThis.fetch(url, init);

    if (response.status === 401) {
      throw new AuthError();
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${this.parseJiraError(text)}`);
    }

    // Handle 204 No Content (e.g., DELETE responses)
    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  private parseJiraError(text: string): string {
    try {
      const json = JSON.parse(text) as JiraErrorResponse;

      const messages: string[] = [];

      if (json.errorMessages && json.errorMessages.length > 0) {
        messages.push(...json.errorMessages);
      }

      if (json.errors && Object.keys(json.errors).length > 0) {
        const fieldErrors = Object.entries(json.errors)
          .map(([field, msg]) => `${field}: ${msg}`)
          .join('; ');
        messages.push(fieldErrors);
      }

      if (messages.length > 0) {
        return messages.join('; ');
      }
    } catch {
      // Not JSON, return raw text
    }

    return text;
  }

  async rest<T>(method: string, path: string, body?: unknown): Promise<T> {
    return this.retry(() => this.fetch<T>(method, path, body));
  }

  async *paginate<T>(path: string): AsyncGenerator<T[]> {
    let startAt = 0;
    let total: number | undefined;

    do {
      const separator = path.includes('?') ? '&' : '?';
      const url = `${path}${separator}startAt=${startAt}`;

      const headers: Record<string, string> = {
        Authorization: this.getAuthHeader(),
        Accept: 'application/json',
      };

      const response = await globalThis.fetch(this.baseUrl + url, {
        method: 'GET',
        headers,
      });

      if (response.status === 401) {
        throw new AuthError();
      }

      if (!response.ok) {
        const text = await response.text();
        throw new Error(
          `HTTP ${response.status}: ${this.parseJiraError(text)}`,
        );
      }

      const json = (await response.json()) as {
        startAt: number;
        maxResults: number;
        total: number;
        issues: T[];
      };

      yield json.issues;

      total = json.total;
      startAt = json.startAt + json.issues.length;
    } while (total !== undefined && startAt < total);
  }
}
