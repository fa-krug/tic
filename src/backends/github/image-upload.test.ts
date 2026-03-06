import { createHash } from 'node:crypto';
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { saveImage } from './image-upload.js';

describe('saveImage', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'tic-img-test-'));
    execFileSync('git', ['init'], { cwd: root, stdio: 'pipe' });
  });

  const imageData = Buffer.from('fake-png-data');
  const expectedHash = createHash('sha256')
    .update(imageData)
    .digest('hex')
    .slice(0, 12);

  it('writes image to .github/tic-images/ and stages it', () => {
    const relPath = saveImage(root, imageData);

    expect(relPath).toBe(`.github/tic-images/${expectedHash}.png`);

    const absPath = join(root, relPath);
    expect(existsSync(absPath)).toBe(true);
    expect(readFileSync(absPath)).toEqual(imageData);

    // Verify file is staged
    const staged = execFileSync('git', ['diff', '--cached', '--name-only'], {
      cwd: root,
      encoding: 'utf-8',
    }).trim();
    expect(staged).toBe(relPath);
  });

  it('produces deterministic paths for same content', () => {
    const path1 = saveImage(root, imageData);
    const path2 = saveImage(root, imageData);
    expect(path1).toBe(path2);
  });

  it('produces different paths for different content', () => {
    const path1 = saveImage(root, imageData);
    const path2 = saveImage(root, Buffer.from('different-data'));
    expect(path1).not.toBe(path2);
  });
});
