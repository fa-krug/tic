#!/usr/bin/env node
import { render } from 'ink';
import { App } from './app.js';
import { LocalBackend } from './backends/local/index.js';
import { runCli } from './cli/index.js';

if (process.argv.length > 2) {
  await runCli(process.argv);
} else {
  const backend = new LocalBackend(process.cwd());
  render(<App backend={backend} />);
}
