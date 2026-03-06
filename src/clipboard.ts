import { execFileSync } from 'node:child_process';
import { readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export function readClipboardImage(): Buffer | null {
  try {
    if (process.platform === 'darwin') {
      const tmp = join(
        tmpdir(),
        'tic-clip-' + randomBytes(4).toString('hex') + '.png',
      );
      try {
        execFileSync('pngpaste', [tmp]);
        const data = readFileSync(tmp);
        return data;
      } finally {
        try {
          unlinkSync(tmp);
        } catch {
          // ignore cleanup errors
        }
      }
    }

    if (process.platform === 'linux') {
      const data = execFileSync(
        'xclip',
        ['-selection', 'clipboard', '-t', 'image/png', '-o'],
        { maxBuffer: 50 * 1024 * 1024 },
      );
      return Buffer.from(data);
    }

    return null;
  } catch {
    return null;
  }
}
