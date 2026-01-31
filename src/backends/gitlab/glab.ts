import { execFileSync } from 'node:child_process';

export function glab<T>(args: string[], cwd: string): T {
  const result = execFileSync('glab', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return JSON.parse(result) as T;
}

export function glabExec(args: string[], cwd: string): string {
  return execFileSync('glab', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}
