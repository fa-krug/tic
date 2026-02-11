import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { configStore } from './configStore.js';
import { defaultConfig } from '../storage/config.js';
import { createDatabase, type TicDatabase } from '../storage/db.js';
import { Storage } from '../storage/index.js';
import { readConfig as readConfigFromDb } from '../storage/config.js';

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

  it('falls back to defaults when no DB', async () => {
    // Don't set database — should fall back to defaults
    await configStore.getState().init('/fake/root');
    const { config } = configStore.getState();
    expect(config.statuses).toEqual(defaultConfig.statuses);
  });

  it('shallow merges partial updates', async () => {
    configStore.getState().setDatabase(db);
    await configStore.getState().init('/fake/root');
    await configStore.getState().update({ backend: 'gitlab' });
    const { config } = configStore.getState();
    expect(config.backend).toBe('gitlab');
    // Other fields unchanged
    expect(config.statuses).toEqual(defaultConfig.statuses);
  });
});
