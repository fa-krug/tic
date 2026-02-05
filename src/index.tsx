#!/usr/bin/env node
import { render } from 'ink';
import { App } from './app.js';
import { createBackendWithSync } from './backends/factory.js';
import { runCli } from './cli/index.js';
import { configStore } from './stores/configStore.js';
import { backendDataStore } from './stores/backendDataStore.js';

if (process.argv.length > 2) {
  await runCli(process.argv);
} else {
  await configStore.getState().init(process.cwd());
  const { backend, syncManager } = await createBackendWithSync(process.cwd());

  await backendDataStore.getState().init(backend, syncManager);

  if (syncManager) {
    syncManager.sync().catch(() => {});
  }

  const app = render(<App backend={backend} syncManager={syncManager} />);
  await app.waitUntilExit();
  backendDataStore.getState().destroy();
  configStore.getState().destroy();
}
