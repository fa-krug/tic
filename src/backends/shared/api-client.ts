export class AuthError extends Error {
  constructor(message = 'Authentication failed') {
    super(message);
    this.name = 'AuthError';
  }
}

export class RateLimitError extends Error {
  resetAt: Date;

  constructor(resetAt: Date, message = 'Rate limit exceeded') {
    super(message);
    this.name = 'RateLimitError';
    this.resetAt = resetAt;
  }
}

export const DEFAULT_TIMEOUT_MS = 15_000;

export abstract class BaseApiClient {
  protected token: string;
  protected baseUrl: string;

  constructor(token: string, baseUrl: string) {
    this.token = token;
    this.baseUrl = baseUrl;
  }

  protected async fetch<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = this.baseUrl + path;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/json',
    };

    const init: RequestInit = { method, headers };

    if (body !== undefined && ['POST', 'PATCH', 'PUT'].includes(method)) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    init.signal = controller.signal;

    let response: Response;
    try {
      response = await globalThis.fetch(url, init);
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

    if (response.status === 403) {
      const remaining = response.headers.get('X-RateLimit-Remaining');
      const reset = response.headers.get('X-RateLimit-Reset');
      if (remaining === '0' && reset) {
        throw new RateLimitError(new Date(Number(reset) * 1000));
      }
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text}`);
    }

    return (await response.json()) as T;
  }

  protected async retry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error: unknown) {
      if (error instanceof AuthError || error instanceof RateLimitError) {
        throw error;
      }

      if (error instanceof Error && error.message.startsWith('HTTP 5')) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return await fn();
      }

      throw error;
    }
  }

  protected checkRateLimit(headers: Headers): void {
    const remaining = headers.get('X-RateLimit-Remaining');
    if (remaining !== null && Number(remaining) < 100) {
      console.warn(`API rate limit warning: ${remaining} requests remaining`);
    }
  }

  abstract paginate<T>(path: string): AsyncGenerator<T[]>;
}
