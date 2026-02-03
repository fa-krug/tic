#!/usr/bin/env node
import { render } from 'ink';
import { App } from './app.js';
import { createBackendWithSync } from './backends/factory.js';
import { runCli } from './cli/index.js';

if (process.argv.length > 2) {
  await runCli(process.argv);
} else {
  const { backend, syncManager } = await createBackendWithSync(process.cwd());

  if (syncManager) {
    syncManager.sync().catch(() => {});
  }

  render(<App backend={backend} syncManager={syncManager} />);
}
