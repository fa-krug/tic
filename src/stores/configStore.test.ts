import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { configStore } from './configStore.js';
import { defaultConfig, writeConfig } from '../backends/local/config.js';
import { createDatabase, type TicDatabase } from '../storage/db.js';
import { Storage } from '../storage/index.js';
import { readConfig as readConfigFromDb } from '../storage/config.js';

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
    configStore.getState().startWatching();
    await writeConfig(tmpDir, {
      ...configStore.getState().config,
      next_id: 99,
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(configStore.getState().config.next_id).toBe(99);
  });

  it('does not double-trigger on self-writes', async () => {
    await configStore.getState().init(tmpDir);
    configStore.getState().startWatching();
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
    configStore.getState().startWatching();
    configStore.getState().destroy();
    await writeConfig(tmpDir, {
      ...configStore.getState().config,
      next_id: 77,
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(configStore.getState().config.next_id).not.toBe(77);
  });
});

describe('configStore with SQLite backing', () => {
  let db: TicDatabase;

  beforeEach(() => {
    db = createDatabase(':memory:');
    // Seed defaults by creating a Storage (which runs seedDefaults).
    // Don't call backend.destroy() — that closes the DB connection we still need.
    Storage.createFromDb(db);
  });

  afterEach(() => {
    configStore.getState().destroy();
    db.close();
  });

  it('reads config from database when setDatabase is called before init', async () => {
    configStore.getState().setDatabase(db);
    await configStore.getState().init('/fake/root');
    const { config, loaded } = configStore.getState();
    expect(loaded).toBe(true);
    // Should read seeded defaults from DB
    expect(config.statuses).toEqual([
      'backlog',
      'todo',
      'in-progress',
      'review',
      'done',
    ]);
  });

  it('writes config to database on update', async () => {
    configStore.getState().setDatabase(db);
    await configStore.getState().init('/fake/root');
    await configStore.getState().update({ next_id: 42 });
    const { config } = configStore.getState();
    expect(config.next_id).toBe(42);

    // Verify persistence: read directly from DB
    const dbConfig = readConfigFromDb(db);
    expect(dbConfig.next_id).toBe(42);
  });

  it('startWatching is no-op with database', async () => {
    configStore.getState().setDatabase(db);
    await configStore.getState().init('/fake/root');
    // Should not throw (no file system operations)
    configStore.getState().startWatching();
  });

  it('destroy resets database reference', async () => {
    configStore.getState().setDatabase(db);
    await configStore.getState().init('/fake/root');
    configStore.getState().destroy();
    expect(configStore.getState().loaded).toBe(false);
  });

  it('falls back to YAML when database is null', async () => {
    // Don't set database — should use YAML path
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-cfg-'));
    await configStore.getState().init(tmpDir);
    const { config } = configStore.getState();
    expect(config.statuses).toEqual(defaultConfig.statuses);
    configStore.getState().destroy();
    fs.rmSync(tmpDir, { recursive: true });
  });
});
