import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const execFileAsync = promisify(execFile);

const AZ_TIMEOUT_MS = 15_000;
const AZ_MAX_BUFFER = 10 * 1024 * 1024; // 10 MB

/** Sync variant — only for constructor use (account check, work item types). */
export function azSync<T>(args: string[], cwd: string): T {
  const result = execFileSync('az', [...args, '-o', 'json'], {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: AZ_TIMEOUT_MS,
    maxBuffer: AZ_MAX_BUFFER,
  });
  return JSON.parse(result) as T;
}

/** Sync variant — only for constructor use. */
export function azExecSync(args: string[], cwd: string): string {
  return execFileSync('az', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: AZ_TIMEOUT_MS,
    maxBuffer: AZ_MAX_BUFFER,
  });
}

export async function az<T>(args: string[], cwd: string): Promise<T> {
  const { stdout } = await execFileAsync('az', [...args, '-o', 'json'], {
    cwd,
    encoding: 'utf-8',
    timeout: AZ_TIMEOUT_MS,
    maxBuffer: AZ_MAX_BUFFER,
  });
  return JSON.parse(stdout) as T;
}

export async function azExec(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('az', args, {
    cwd,
    encoding: 'utf-8',
    timeout: AZ_TIMEOUT_MS,
    maxBuffer: AZ_MAX_BUFFER,
  });
  return stdout;
}

export interface AzInvokeOptions {
  area: string;
  resource: string;
  httpMethod?: string;
  routeParameters?: string;
  body?: unknown;
  apiVersion?: string;
}

/** Sync variant — only for constructor use. */
export function azInvokeSync<T>(options: AzInvokeOptions, cwd: string): T {
  const args = [
    'devops',
    'invoke',
    '--area',
    options.area,
    '--resource',
    options.resource,
  ];

  if (options.httpMethod) {
    args.push('--http-method', options.httpMethod);
  }
  if (options.routeParameters) {
    args.push('--route-parameters', options.routeParameters);
  }
  if (options.apiVersion) {
    args.push('--api-version', options.apiVersion);
  }

  let tmpFile: string | undefined;
  if (options.body) {
    tmpFile = path.join(os.tmpdir(), `tic-az-${Date.now()}.json`);
    fs.writeFileSync(tmpFile, JSON.stringify(options.body));
    args.push('--in-file', tmpFile);
  }

  try {
    const result = execFileSync('az', [...args, '-o', 'json'], {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: AZ_TIMEOUT_MS,
      maxBuffer: AZ_MAX_BUFFER,
    });
    return JSON.parse(result) as T;
  } finally {
    if (tmpFile) {
      fs.unlinkSync(tmpFile);
    }
  }
}

export interface AzRestOptions {
  url: string;
  httpMethod?: string;
  body?: unknown;
}

/**
 * Call Azure DevOps REST APIs directly via `az rest`.
 * Use this instead of azInvoke for preview APIs that
 * `az devops invoke` cannot handle (it fails to parse preview version strings).
 */
export async function azRest<T>(
  options: AzRestOptions,
  cwd: string,
): Promise<T> {
  const args = ['rest', '--uri', options.url];

  if (options.httpMethod) {
    args.push('--method', options.httpMethod);
  }

  let tmpFile: string | undefined;
  if (options.body) {
    tmpFile = path.join(os.tmpdir(), `tic-az-${Date.now()}.json`);
    await fsp.writeFile(tmpFile, JSON.stringify(options.body));
    args.push('--body', `@${tmpFile}`);
  }

  // Azure DevOps resource ID for authentication
  args.push('--resource', '499b84ac-1321-427f-aa17-267ca6975798');

  try {
    const { stdout } = await execFileAsync('az', args, {
      cwd,
      encoding: 'utf-8',
      timeout: AZ_TIMEOUT_MS,
      maxBuffer: AZ_MAX_BUFFER,
    });
    return JSON.parse(stdout) as T;
  } finally {
    if (tmpFile) {
      await fsp.unlink(tmpFile);
    }
  }
}

export async function azInvoke<T>(
  options: AzInvokeOptions,
  cwd: string,
): Promise<T> {
  const args = [
    'devops',
    'invoke',
    '--area',
    options.area,
    '--resource',
    options.resource,
  ];

  if (options.httpMethod) {
    args.push('--http-method', options.httpMethod);
  }
  if (options.routeParameters) {
    args.push('--route-parameters', options.routeParameters);
  }
  if (options.apiVersion) {
    args.push('--api-version', options.apiVersion);
  }

  let tmpFile: string | undefined;
  if (options.body) {
    tmpFile = path.join(os.tmpdir(), `tic-az-${Date.now()}.json`);
    await fsp.writeFile(tmpFile, JSON.stringify(options.body));
    args.push('--in-file', tmpFile);
  }

  try {
    const { stdout } = await execFileAsync('az', [...args, '-o', 'json'], {
      cwd,
      encoding: 'utf-8',
      timeout: AZ_TIMEOUT_MS,
      maxBuffer: AZ_MAX_BUFFER,
    });
    return JSON.parse(stdout) as T;
  } finally {
    if (tmpFile) {
      await fsp.unlink(tmpFile);
    }
  }
}
