#!/usr/bin/env node
import { render } from 'ink';
import { App } from './app.js';
import { createBackendWithSync } from './backends/factory.js';
import { runCli } from './cli/index.js';

if (process.argv.length > 2) {
  await runCli(process.argv);
} else {
  const { backend, syncManager } = createBackendWithSync(process.cwd());

  if (syncManager) {
    const items = backend.listWorkItems();
    if (items.length === 0) {
      process.stderr.write('Syncing...\n');
      await syncManager.sync();
    } else {
      syncManager.sync().catch(() => {});
    }
  }

  render(<App backend={backend} syncManager={syncManager} />);
}
