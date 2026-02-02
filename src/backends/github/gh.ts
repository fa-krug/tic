import { execFileSync } from 'node:child_process';

export function gh<T>(args: string[], cwd: string): T {
  const result = execFileSync('gh', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return JSON.parse(result) as T;
}

export function ghExec(args: string[], cwd: string): string {
  return execFileSync('gh', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

export function ghGraphQL<T>(
  query: string,
  variables: Record<string, string | number | null>,
  cwd: string,
): T {
  const args = [
    'api',
    'graphql',
    '-H',
    'GraphQL-Features: sub_issues',
    '-f',
    `query=${query}`,
  ];
  for (const [key, value] of Object.entries(variables)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'number') {
      args.push('-F', `${key}=${value}`);
    } else {
      args.push('-f', `${key}=${value}`);
    }
  }
  const result = execFileSync('gh', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return (JSON.parse(result) as { data: T }).data;
}
