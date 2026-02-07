import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Sync variant — only for constructor use (auth check). */
export function acliSync<T>(args: string[], cwd: string): T {
  const result = execFileSync('acli', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return JSON.parse(result) as T;
}

/** Sync variant — only for constructor use (auth check). */
export function acliExecSync(args: string[], cwd: string): string {
  return execFileSync('acli', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

export async function acli<T>(args: string[], cwd: string): Promise<T> {
  const { stdout } = await execFileAsync('acli', args, {
    cwd,
    encoding: 'utf-8',
  });
  return JSON.parse(stdout) as T;
}

export async function acliExec(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('acli', args, {
    cwd,
    encoding: 'utf-8',
  });
  return stdout;
}
