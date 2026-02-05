import { execSync, spawn } from 'node:child_process';

const PACKAGE_NAME = '@sascha384/tic';

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
  const child = spawn(command, args, {
    stdio: 'inherit',
    detached: false,
  });

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });
}

// When run directly as a script
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('/updater.js') ||
    process.argv[1].endsWith('\\updater.js'));

if (isDirectRun) {
  const originalArgs = process.argv.slice(2);
  runUpdate(originalArgs);
}
