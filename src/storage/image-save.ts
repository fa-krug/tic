import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, extname } from 'node:path';

export function saveImageLocal(
  root: string,
  imageData: Buffer,
  filename?: string,
): string {
  const hash = createHash('sha256')
    .update(imageData)
    .digest('hex')
    .slice(0, 12);
  const ext = filename ? extname(filename) || '.png' : '.png';
  const relPath = `.tic/images/${hash}${ext}`;
  const absDir = join(root, '.tic', 'images');
  const absPath = join(root, relPath);

  mkdirSync(absDir, { recursive: true });
  writeFileSync(absPath, imageData);

  try {
    execFileSync('git', ['add', relPath], { cwd: root, stdio: 'pipe' });
  } catch {
    // Not in a git repo — skip staging
  }

  return relPath;
}
