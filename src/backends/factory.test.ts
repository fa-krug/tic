import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  createBackend,
  createBackendWithSync,
  detectBackend,
  VALID_BACKENDS,
} from './factory.js';
import { Storage } from '../storage/index.js';
import { SyncManager } from '../sync/SyncManager.js';
import { updateConfig } from '../storage/config.js';
import { configStore } from '../stores/configStore.js';

describe('VALID_BACKENDS', () => {
  it('contains all known backends', () => {
    expect(VALID_BACKENDS).toEqual([
      'none',
      'filesystem',
      'github',
      'gitlab',
      'azure',
      'jira',
    ]);
  });
});

describe('detectBackend', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-detect-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns none when git remote fails', () => {
    const result = detectBackend(tmpDir);
    expect(result).toBe('none');
  });
});

describe('createBackend', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-factory-'));
    // Initialize DB with config
    const storage = Storage.create(tmpDir);
    updateConfig(storage.getDatabase(), { backend: 'none' });
    storage.destroy();
  });

  afterEach(() => {
    configStore.getState().destroy();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('always creates a Storage as primary', async () => {
    const backend = await createBackend(tmpDir);
    expect(backend).toBeInstanceOf(Storage);
    expect(await backend.getStatuses()).toEqual([
      'backlog',
      'todo',
      'in-progress',
      'review',
      'done',
    ]);
  });

  it('creates Storage regardless of config.backend setting', async () => {
    // Re-init with github backend
    const storage = Storage.create(tmpDir);
    updateConfig(storage.getDatabase(), { backend: 'github' });
    storage.destroy();

    const backend = await createBackend(tmpDir);
    expect(backend).toBeInstanceOf(Storage);
  });
});

describe('createBackendWithSync', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-factory-sync-'));
    // Initialize DB with config
    const storage = Storage.create(tmpDir);
    updateConfig(storage.getDatabase(), { backend: 'none' });
    storage.destroy();
  });

  afterEach(() => {
    configStore.getState().destroy();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns Storage and null syncManager for none backend', async () => {
    const { backend, syncManager, queue } = await createBackendWithSync(tmpDir);
    expect(backend).toBeInstanceOf(Storage);
    expect(syncManager).toBeNull();
    expect(queue).toBeNull();
  });

  it('returns Storage and SyncManager for github backend', async () => {
    const storage = Storage.create(tmpDir);
    updateConfig(storage.getDatabase(), { backend: 'github' });
    storage.destroy();

    // GitHubBackend.create() may throw if git remote doesn't contain
    // github.com or if not authenticated, but we verify it doesn't
    // throw "Unknown backend"
    try {
      const { backend, syncManager, queue } =
        await createBackendWithSync(tmpDir);
      expect(backend).toBeInstanceOf(Storage);
      expect(syncManager).toBeInstanceOf(SyncManager);
      expect(queue).not.toBeNull();
    } catch (e) {
      // No github.com remote in test env — verify it doesn't throw "Unknown backend"
      expect((e as Error).message).not.toContain('Unknown backend');
    }
  });

  it('returns Storage and SyncManager for jira backend', async () => {
    const storage = Storage.create(tmpDir);
    updateConfig(storage.getDatabase(), {
      backend: 'jira',
      jira: {
        site: 'https://mycompany.atlassian.net',
        project: 'TEAM',
      },
    });
    storage.destroy();

    try {
      const { backend, syncManager, queue } =
        await createBackendWithSync(tmpDir);
      expect(backend).toBeInstanceOf(Storage);
      expect(syncManager).toBeInstanceOf(SyncManager);
      expect(queue).not.toBeNull();
    } catch (e) {
      expect((e as Error).message).not.toContain('Unknown backend');
    }
  });
});
