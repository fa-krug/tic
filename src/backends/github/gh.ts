import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Sync variant — only for constructor use (auth check). */
export function ghSync<T>(args: string[], cwd: string): T {
  const result = execFileSync('gh', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return JSON.parse(result) as T;
}

/** Sync variant — only for constructor use (auth check). */
export function ghExecSync(args: string[], cwd: string): string {
  return execFileSync('gh', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

export async function gh<T>(args: string[], cwd: string): Promise<T> {
  const { stdout } = await execFileAsync('gh', args, {
    cwd,
    encoding: 'utf-8',
  });
  return JSON.parse(stdout) as T;
}

export async function ghExec(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('gh', args, {
    cwd,
    encoding: 'utf-8',
  });
  return stdout;
}

export async function ghGraphQL<T>(
  query: string,
  variables: Record<string, string | number | null>,
  cwd: string,
): Promise<T> {
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
  const { stdout } = await execFileAsync('gh', args, {
    cwd,
    encoding: 'utf-8',
  });
  const parsed = JSON.parse(stdout) as {
    data?: T;
    errors?: { message: string }[];
  };
  if (parsed.errors?.length) {
    throw new Error(`GraphQL error: ${parsed.errors[0]!.message}`);
  }
  return parsed.data as T;
}

/** Sync variant — only for getItemUrl() which must return string synchronously. */
export function ghGraphQLSync<T>(
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
  const parsed = JSON.parse(result) as {
    data?: T;
    errors?: { message: string }[];
  };
  if (parsed.errors?.length) {
    throw new Error(`GraphQL error: ${parsed.errors[0]!.message}`);
  }
  return parsed.data as T;
}
