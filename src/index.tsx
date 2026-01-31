#!/usr/bin/env node
import { render } from 'ink';
import { App } from './app.js';
import { LocalBackend } from './backends/local/index.js';

const backend = new LocalBackend(process.cwd());
render(<App backend={backend} />);
