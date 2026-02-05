import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { configStore } from './configStore.js';
import { defaultConfig, writeConfig } from '../backends/local/config.js';

describe('configStore', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-config-store-'));
  });

  afterEach(() => {
    configStore.getState().destroy();
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('loads default config when no file exists', async () => {
    await configStore.getState().init(tmpDir);
    const { config, loaded } = configStore.getState();
    expect(loaded).toBe(true);
    expect(config.statuses).toEqual(defaultConfig.statuses);
    expect(config.next_id).toBe(1);
  });

  it('loads existing config from disk', async () => {
    const ticDir = path.join(tmpDir, '.tic');
    fs.mkdirSync(ticDir, { recursive: true });
    fs.writeFileSync(
      path.join(ticDir, 'config.yml'),
      'backend: github\nstatuses:\n  - open\ncurrent_iteration: v1\niterations:\n  - v1\nnext_id: 5\n',
    );
    await configStore.getState().init(tmpDir);
    const { config } = configStore.getState();
    expect(config.backend).toBe('github');
    expect(config.next_id).toBe(5);
  });

  it('updates config and writes to disk', async () => {
    await configStore.getState().init(tmpDir);
    await configStore.getState().update({ next_id: 42 });
    const { config } = configStore.getState();
    expect(config.next_id).toBe(42);
    const raw = fs.readFileSync(
      path.join(tmpDir, '.tic', 'config.yml'),
      'utf-8',
    );
    expect(raw).toContain('next_id: 42');
  });

  it('shallow merges partial updates', async () => {
    await configStore.getState().init(tmpDir);
    await configStore.getState().update({ backend: 'gitlab' });
    const { config } = configStore.getState();
    expect(config.backend).toBe('gitlab');
    expect(config.statuses).toEqual(defaultConfig.statuses);
  });

  it('picks up external file changes', async () => {
    await configStore.getState().init(tmpDir);
    await writeConfig(tmpDir, {
      ...configStore.getState().config,
      next_id: 99,
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(configStore.getState().config.next_id).toBe(99);
  });

  it('does not double-trigger on self-writes', async () => {
    await configStore.getState().init(tmpDir);
    let changeCount = 0;
    const unsub = configStore.subscribe(() => {
      changeCount++;
    });
    await configStore.getState().update({ next_id: 10 });
    await new Promise((r) => setTimeout(r, 200));
    unsub();
    expect(changeCount).toBe(1);
  });

  it('destroy stops the file watcher', async () => {
    await configStore.getState().init(tmpDir);
    configStore.getState().destroy();
    await writeConfig(tmpDir, {
      ...configStore.getState().config,
      next_id: 77,
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(configStore.getState().config.next_id).not.toBe(77);
  });
});
