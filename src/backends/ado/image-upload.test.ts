import { describe, it, expect, vi, afterEach } from 'vitest';
import { AdoApiClient } from './api.js';

describe('AdoApiClient.uploadAttachment', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends binary data with octet-stream content type', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: () =>
        Promise.resolve({
          url: 'https://dev.azure.com/org/project/_apis/wit/attachments/abc',
        }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const client = new AdoApiClient({ type: 'basic', pat: 'test-pat' }, 'org');
    const url = await client.uploadAttachment(
      'project',
      Buffer.from('fake-img'),
      'test.png',
    );

    expect(url).toBe(
      'https://dev.azure.com/org/project/_apis/wit/attachments/abc',
    );
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/_apis/wit/attachments'),
      expect.objectContaining({
        method: 'POST',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        headers: expect.objectContaining({
          'Content-Type': 'application/octet-stream',
        }),
      }),
    );
  });
});
