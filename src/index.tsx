#!/usr/bin/env node
import { render } from 'ink';
import { App } from './app.js';
import { createBackend } from './backends/factory.js';
import { runCli } from './cli/index.js';

if (process.argv.length > 2) {
  await runCli(process.argv);
} else {
  const backend = createBackend(process.cwd());
  render(<App backend={backend} />);
}
