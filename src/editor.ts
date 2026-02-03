import { spawnSync } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * Opens the user's preferred editor with the given content.
 * Returns the edited content when the editor closes.
 */
export function openInEditor(content: string): string {
  const editor = process.env['VISUAL'] || process.env['EDITOR'] || 'vi';
  const tmpFile = join(tmpdir(), `tic-edit-${Date.now()}.md`);

  try {
    writeFileSync(tmpFile, content, 'utf-8');

    const result = spawnSync(editor, [tmpFile], {
      stdio: 'inherit',
      shell: true,
    });

    if (result.status !== 0) {
      throw new Error(`Editor exited with status ${result.status}`);
    }

    return readFileSync(tmpFile, 'utf-8');
  } finally {
    try {
      unlinkSync(tmpFile);
    } catch {
      // Ignore cleanup errors
    }
  }
}
