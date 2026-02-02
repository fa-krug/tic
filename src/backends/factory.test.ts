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
import { LocalBackend } from './local/index.js';
import { SyncManager } from '../sync/SyncManager.js';
import { writeConfig, defaultConfig } from './local/config.js';

describe('VALID_BACKENDS', () => {
  it('contains the four known backends', () => {
    expect(VALID_BACKENDS).toEqual(['local', 'github', 'gitlab', 'azure']);
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
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('creates a LocalBackend when backend is local', async () => {
    await writeConfig(tmpDir, { ...defaultConfig, backend: 'local' });
    const backend = await createBackend(tmpDir);
    expect(await backend.getStatuses()).toEqual(defaultConfig.statuses);
  });

  it('attempts to create GitHubBackend when backend is github', async () => {
    await writeConfig(tmpDir, { ...defaultConfig, backend: 'github' });
    // Throws because gh auth will fail in test env, but NOT "not yet implemented"
    try {
      await createBackend(tmpDir);
    } catch (e) {
      expect((e as Error).message).not.toContain('not yet implemented');
    }
  });

  it('attempts to create GitLabBackend when backend is gitlab', async () => {
    await writeConfig(tmpDir, { ...defaultConfig, backend: 'gitlab' });
    // Throws because glab auth will fail in test env, but NOT "not yet implemented"
    try {
      await createBackend(tmpDir);
    } catch (e) {
      expect((e as Error).message).not.toContain('not yet implemented');
    }
  });

  it(
    'attempts to create AzureDevOpsBackend when backend is azure',
    { timeout: 20_000 },
    async () => {
      await writeConfig(tmpDir, { ...defaultConfig, backend: 'azure' });
      // Throws because az auth will fail in test env, but NOT "not yet implemented"
      try {
        await createBackend(tmpDir);
      } catch (e) {
        expect((e as Error).message).not.toContain('not yet implemented');
      }
    },
  );

  it('throws for unknown backend values', async () => {
    await writeConfig(tmpDir, { ...defaultConfig, backend: 'jira' });
    await expect(createBackend(tmpDir)).rejects.toThrow('Unknown backend');
  });
});

describe('createBackendWithSync', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-factory-sync-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns LocalBackend and null syncManager for local backend', async () => {
    await writeConfig(tmpDir, { ...defaultConfig, backend: 'local' });
    const { backend, syncManager } = await createBackendWithSync(tmpDir);
    expect(backend).toBeInstanceOf(LocalBackend);
    expect(syncManager).toBeNull();
  });

  it('returns LocalBackend and SyncManager for github backend', async () => {
    await writeConfig(tmpDir, { ...defaultConfig, backend: 'github' });
    // GitHubBackend constructor may throw if gh is not authenticated,
    // but we still expect the right types when it succeeds
    try {
      const { backend, syncManager } = await createBackendWithSync(tmpDir);
      expect(backend).toBeInstanceOf(LocalBackend);
      expect(syncManager).toBeInstanceOf(SyncManager);
    } catch (e) {
      // gh CLI not available in test env — verify it doesn't throw "Unknown backend"
      expect((e as Error).message).not.toContain('Unknown backend');
    }
  });
});
