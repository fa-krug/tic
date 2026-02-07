import { execSync, spawnSync } from 'node:child_process';

const PACKAGE_NAME = '@sascha384/tic';

let _updateRequested = false;

export function requestUpdate(): void {
  _updateRequested = true;
}

export function isUpdateRequested(): boolean {
  return _updateRequested;
}

export function buildUpdateCommand(): string {
  return `npm install -g ${PACKAGE_NAME}@latest`;
}

export function buildRelaunchArgs(originalArgs: string[]): {
  command: string;
  args: string[];
} {
  return { command: 'tic', args: originalArgs };
}

export function runUpdate(originalArgs: string[]): void {
  const cmd = buildUpdateCommand();

  console.log(`\nUpdating ${PACKAGE_NAME}...\n`);

  try {
    execSync(cmd, { stdio: 'inherit' });
  } catch {
    console.error(`\nUpdate failed. Run manually: ${cmd}\n`);
    process.exit(1);
  }

  console.log('\nUpdate complete! Restarting tic...\n');

  const { command, args } = buildRelaunchArgs(originalArgs);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
  });

  process.exit(result.status ?? 0);
}
