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
import { DrizzleBackend } from './drizzle/index.js';
import { SyncManager } from '../sync/SyncManager.js';
import { writeConfig, defaultConfig } from './local/config.js';
import { configStore } from '../stores/configStore.js';

describe('VALID_BACKENDS', () => {
  it('contains all known backends', () => {
    expect(VALID_BACKENDS).toEqual([
      'none',
      'filesystem',
      'local',
      'github',
      'gitlab',
      'azure',
      'jira',
    ]);
  });
});

describe('detectBackend', () => {
  it('returns local when git remote fails', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-detect-'));
    const result = detectBackend(tmpDir);
    expect(result).toBe('local');
    fs.rmSync(tmpDir, { recursive: true });
  });
});

describe('createBackend', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-factory-'));
  });

  afterEach(() => {
    configStore.getState().destroy();
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('always creates a DrizzleBackend as primary', async () => {
    await writeConfig(tmpDir, { ...defaultConfig, backend: 'local' });
    const backend = await createBackend(tmpDir);
    expect(backend).toBeInstanceOf(DrizzleBackend);
    expect(await backend.getStatuses()).toEqual(defaultConfig.statuses);
  });

  it('creates DrizzleBackend regardless of config.backend setting', async () => {
    await writeConfig(tmpDir, { ...defaultConfig, backend: 'github' });
    const backend = await createBackend(tmpDir);
    expect(backend).toBeInstanceOf(DrizzleBackend);
  });
});

describe('createBackendWithSync', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-factory-sync-'));
  });

  afterEach(() => {
    configStore.getState().destroy();
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns DrizzleBackend and null syncManager for local backend', async () => {
    await writeConfig(tmpDir, { ...defaultConfig, backend: 'local' });
    const { backend, syncManager, queue } = await createBackendWithSync(tmpDir);
    expect(backend).toBeInstanceOf(DrizzleBackend);
    expect(syncManager).toBeNull();
    expect(queue).toBeNull();
  });

  it('returns DrizzleBackend and SyncManager for github backend', async () => {
    await writeConfig(tmpDir, { ...defaultConfig, backend: 'github' });
    // GitHubBackend constructor may throw if gh is not authenticated,
    // but we still expect the right types when it succeeds
    try {
      const { backend, syncManager, queue } =
        await createBackendWithSync(tmpDir);
      expect(backend).toBeInstanceOf(DrizzleBackend);
      expect(syncManager).toBeInstanceOf(SyncManager);
      expect(queue).not.toBeNull();
    } catch (e) {
      // gh CLI not available in test env — verify it doesn't throw "Unknown backend"
      expect((e as Error).message).not.toContain('Unknown backend');
    }
  });

  it('returns DrizzleBackend and SyncManager for jira backend', async () => {
    await writeConfig(tmpDir, {
      ...defaultConfig,
      backend: 'jira',
      jira: {
        site: 'https://mycompany.atlassian.net',
        project: 'TEAM',
      },
    });
    try {
      const { backend, syncManager, queue } =
        await createBackendWithSync(tmpDir);
      expect(backend).toBeInstanceOf(DrizzleBackend);
      expect(syncManager).toBeInstanceOf(SyncManager);
      expect(queue).not.toBeNull();
    } catch (e) {
      expect((e as Error).message).not.toContain('Unknown backend');
    }
  });
});
