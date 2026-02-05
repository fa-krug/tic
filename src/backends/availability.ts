import { execFile } from 'node:child_process';
import type { BackendType } from './factory.js';

/**
 * Maps each backend to the CLI binary it requires, or null if no CLI is needed.
 */
export const BACKEND_CLI: Record<BackendType, string | null> = {
  local: null,
  github: 'gh',
  gitlab: 'glab',
  azure: 'az',
  jira: null,
};

/**
 * Check whether a single backend's CLI tool is available.
 * Returns true if no CLI is required (e.g. local, jira) or if the binary responds to --version.
 */
export async function checkBackendAvailability(
  backend: BackendType,
): Promise<boolean> {
  const binary = BACKEND_CLI[backend];
  if (binary === null) return true;

  return new Promise((resolve) => {
    const child = execFile(
      binary,
      ['--version'],
      { timeout: 5000 },
      (error) => {
        resolve(!error);
      },
    );
    child.on('error', () => resolve(false));
  });
}

/**
 * Check availability of all backends in parallel.
 */
export async function checkAllBackendAvailability(): Promise<
  Record<BackendType, boolean>
> {
  const backends: BackendType[] = [
    'local',
    'github',
    'gitlab',
    'azure',
    'jira',
  ];
  const results = await Promise.all(
    backends.map(async (b) => [b, await checkBackendAvailability(b)] as const),
  );
  return Object.fromEntries(results) as Record<BackendType, boolean>;
}
