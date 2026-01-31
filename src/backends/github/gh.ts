import { execSync } from 'node:child_process';

export function gh<T>(args: string[], cwd: string): T {
  const result = execSync(`gh ${args.join(' ')}`, {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return JSON.parse(result) as T;
}

export function ghExec(args: string[], cwd: string): string {
  return execSync(`gh ${args.join(' ')}`, {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}
