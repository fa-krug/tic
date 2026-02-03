#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';

const version = process.argv[2];
if (!version) {
  console.error('Usage: sync-plugin-version.js <version>');
  process.exit(1);
}

const pluginPath = '.claude-plugin/plugin.json';
const plugin = JSON.parse(readFileSync(pluginPath, 'utf8'));
plugin.version = version;
writeFileSync(pluginPath, JSON.stringify(plugin, null, 2) + '\n');
console.log(`Updated ${pluginPath} to version ${version}`);
