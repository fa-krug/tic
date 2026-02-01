import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function az<T>(args: string[], cwd: string): T {
  const result = execFileSync('az', [...args, '-o', 'json'], {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return JSON.parse(result) as T;
}

export function azExec(args: string[], cwd: string): string {
  return execFileSync('az', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

export interface AzInvokeOptions {
  area: string;
  resource: string;
  httpMethod?: string;
  routeParameters?: string;
  body?: unknown;
  apiVersion?: string;
}

export function azInvoke<T>(options: AzInvokeOptions, cwd: string): T {
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
    });
    return JSON.parse(result) as T;
  } finally {
    if (tmpFile) {
      fs.unlinkSync(tmpFile);
    }
  }
}
