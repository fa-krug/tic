import { describe, it, expect, vi, afterEach } from 'vitest';

describe('GitLabApiClient.uploadFile', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends multipart upload and returns parsed response', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: () =>
        Promise.resolve({
          alt: 'screenshot',
          url: '/uploads/abc123/screenshot.png',
          full_path: '/mygroup/myproject/uploads/abc123/screenshot.png',
          markdown: '![screenshot](/uploads/abc123/screenshot.png)',
        }),
    };
    const mockFetch = vi.fn().mockResolvedValue(mockResponse);
    vi.stubGlobal('fetch', mockFetch);

    const { GitLabApiClient } = await import('./api.js');
    const client = new GitLabApiClient('test-token');
    const result = await client.uploadFile(
      'mygroup/myproject',
      Buffer.from('fake-png'),
      'screenshot.png',
    );

    expect(result.url).toBe('/mygroup/myproject/uploads/abc123/screenshot.png');
    expect(result.markdown).toBe(
      '![screenshot](/uploads/abc123/screenshot.png)',
    );
    expect(mockFetch).toHaveBeenCalledWith(
      'https://gitlab.com/api/v4/projects/mygroup%2Fmyproject/uploads',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
