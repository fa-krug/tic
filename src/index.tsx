#!/usr/bin/env node
import module from 'node:module';
module.enableCompileCache?.();

import { render } from 'ink';
import { App } from './app.js';
import { configStore } from './stores/configStore.js';
import { backendDataStore } from './stores/backendDataStore.js';

if (process.argv.length > 2) {
  const { runCli } = await import('./cli/index.js');
  await runCli(process.argv);
} else {
  const cwd = process.cwd();
  await configStore.getState().init(cwd);

  // Init is non-blocking - UI renders immediately with loading state
  backendDataStore.getState().init(cwd);

  const app = render(<App />);
  await app.waitUntilExit();
  backendDataStore.getState().destroy();
  configStore.getState().destroy();
}
