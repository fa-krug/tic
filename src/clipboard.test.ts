import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecFileSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockUnlinkSync = vi.fn();

vi.mock('node:child_process', () => ({
  execFileSync: mockExecFileSync,
}));

vi.mock('node:fs', () => ({
  readFileSync: mockReadFileSync,
  unlinkSync: mockUnlinkSync,
}));

describe('readClipboardImage', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
  });

  it('returns Buffer when clipboard has image on macOS', async () => {
    const platformSpy = vi
      .spyOn(process, 'platform', 'get')
      .mockReturnValue('darwin');
    const fakeImage = Buffer.from('fake-png-data');
    mockExecFileSync.mockReturnValue(undefined);
    mockReadFileSync.mockReturnValue(fakeImage);

    const { readClipboardImage } = await import('./clipboard.js');
    const result = readClipboardImage();

    expect(result).toEqual(fakeImage);
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'osascript',
      ['-l', 'JavaScript', '-e', expect.stringContaining('NSPasteboard')],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    expect(mockReadFileSync).toHaveBeenCalled();
    expect(mockUnlinkSync).toHaveBeenCalled();

    platformSpy.mockRestore();
  });

  it('returns null when clipboard has no image on macOS (osascript throws)', async () => {
    const platformSpy = vi
      .spyOn(process, 'platform', 'get')
      .mockReturnValue('darwin');
    mockExecFileSync.mockImplementation(() => {
      throw new Error('osascript exited with code 1');
    });

    const { readClipboardImage } = await import('./clipboard.js');
    const result = readClipboardImage();

    expect(result).toBeNull();

    platformSpy.mockRestore();
  });

  it('returns null on unsupported platform', async () => {
    const platformSpy = vi
      .spyOn(process, 'platform', 'get')
      .mockReturnValue('win32');

    const { readClipboardImage } = await import('./clipboard.js');
    const result = readClipboardImage();

    expect(result).toBeNull();
    expect(mockExecFileSync).not.toHaveBeenCalled();

    platformSpy.mockRestore();
  });

  it('returns Buffer from xclip on Linux', async () => {
    const platformSpy = vi
      .spyOn(process, 'platform', 'get')
      .mockReturnValue('linux');
    const fakeImage = Buffer.from('linux-png-data');
    // which xclip succeeds, then xclip succeeds
    mockExecFileSync.mockReturnValue(fakeImage);

    const { readClipboardImage } = await import('./clipboard.js');
    const result = readClipboardImage();

    expect(result).toEqual(fakeImage);
    expect(mockExecFileSync).toHaveBeenCalledWith('which', ['xclip'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'xclip',
      ['-selection', 'clipboard', '-t', 'image/png', '-o'],
      { maxBuffer: 50 * 1024 * 1024 },
    );

    platformSpy.mockRestore();
  });

  it('throws ClipboardError when xclip not installed on Linux', async () => {
    const platformSpy = vi
      .spyOn(process, 'platform', 'get')
      .mockReturnValue('linux');
    mockExecFileSync.mockImplementation(() => {
      throw new Error('not found');
    });

    const { readClipboardImage, ClipboardError } =
      await import('./clipboard.js');

    expect(() => readClipboardImage()).toThrow(ClipboardError);
    expect(() => readClipboardImage()).toThrow('xclip is required');

    platformSpy.mockRestore();
  });

  it('returns null when xclip has no image on Linux', async () => {
    const platformSpy = vi
      .spyOn(process, 'platform', 'get')
      .mockReturnValue('linux');
    let callCount = 0;
    mockExecFileSync.mockImplementation(() => {
      callCount++;
      // First call is 'which xclip' — succeeds
      if (callCount === 1) return undefined;
      // Second call is 'xclip' — fails (no image)
      throw new Error('no image');
    });

    const { readClipboardImage } = await import('./clipboard.js');
    const result = readClipboardImage();

    expect(result).toBeNull();

    platformSpy.mockRestore();
  });
});
