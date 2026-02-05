import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkForUpdate } from './update-checker.js';
import { VERSION } from './version.js';

describe('checkForUpdate', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns updateAvailable true when registry has newer version', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ version: '99.0.0' }),
    } as Response);

    const result = await checkForUpdate();
    expect(result).toEqual({
      current: VERSION,
      latest: '99.0.0',
      updateAvailable: true,
    });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://registry.npmjs.org/@sascha384/tic/latest',
      expect.objectContaining({
        signal: expect.any(AbortSignal) as AbortSignal,
      }),
    );
  });

  it('returns updateAvailable false when versions match', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ version: VERSION }),
    } as Response);

    const result = await checkForUpdate();
    expect(result).toEqual({
      current: VERSION,
      latest: VERSION,
      updateAvailable: false,
    });
  });

  it('returns null on network error', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockRejectedValue(new Error('network error'));

    const result = await checkForUpdate();
    expect(result).toBeNull();
  });

  it('returns null on non-ok response', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
    } as Response);

    const result = await checkForUpdate();
    expect(result).toBeNull();
  });

  it('returns null on invalid JSON', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ unexpected: 'shape' }),
    } as Response);

    const result = await checkForUpdate();
    expect(result).toBeNull();
  });
});
