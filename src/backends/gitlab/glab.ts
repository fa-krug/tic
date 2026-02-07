import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Sync variant — only for constructor use (auth check). */
export function glabSync<T>(args: string[], cwd: string): T {
  const result = execFileSync('glab', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const trimmed = result.trim();
  if (!trimmed || (!trimmed.startsWith('[') && !trimmed.startsWith('{'))) {
    return [] as unknown as T;
  }
  return JSON.parse(trimmed) as T;
}

/** Sync variant — only for constructor use (auth check). */
export function glabExecSync(args: string[], cwd: string): string {
  return execFileSync('glab', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

export async function glab<T>(args: string[], cwd: string): Promise<T> {
  const { stdout } = await execFileAsync('glab', args, {
    cwd,
    encoding: 'utf-8',
  });
  const trimmed = stdout.trim();
  if (!trimmed || (!trimmed.startsWith('[') && !trimmed.startsWith('{'))) {
    return [] as unknown as T;
  }
  return JSON.parse(trimmed) as T;
}

export async function glabExec(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('glab', args, {
    cwd,
    encoding: 'utf-8',
  });
  return stdout;
}
