import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * Saves a clipboard image to `.github/tic-images/` in the repo and stages it
 * with `git add`. Returns a relative markdown-compatible path.
 */
export function saveImage(root: string, imageData: Buffer): string {
  const hash = createHash('sha256')
    .update(imageData)
    .digest('hex')
    .slice(0, 12);
  const relPath = `.github/tic-images/${hash}.png`;
  const absDir = join(root, '.github', 'tic-images');
  const absPath = join(root, relPath);

  mkdirSync(absDir, { recursive: true });
  writeFileSync(absPath, imageData);
  execFileSync('git', ['add', relPath], { cwd: root, stdio: 'pipe' });

  return relPath;
}
