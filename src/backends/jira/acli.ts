import { execFileSync } from 'node:child_process';

export function acli<T>(args: string[], cwd: string): T {
  const result = execFileSync('acli', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return JSON.parse(result) as T;
}

export function acliExec(args: string[], cwd: string): string {
  return execFileSync('acli', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}
