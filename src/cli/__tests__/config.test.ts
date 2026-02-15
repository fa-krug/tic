import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runConfigGet, runConfigSet } from '../commands/config.js';
import { Storage } from '../../storage/index.js';
import { readConfig as readConfigFromDb } from '../../storage/config.js';

describe('tic config', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-config-test-'));
    // Create DB with default config
    const storage = Storage.create(tmpDir);
    storage.destroy();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('get', () => {
    it('returns the value of a config key', async () => {
      const value = await runConfigGet(tmpDir, 'backend');
      // Seed default is 'drizzle'
      expect(value).toBe('drizzle');
    });

    it('returns current_iteration', async () => {
      const value = await runConfigGet(tmpDir, 'current_iteration');
      expect(value).toBe('default');
    });

    it('throws for unknown keys', async () => {
      await expect(runConfigGet(tmpDir, 'nonexistent')).rejects.toThrow(
        'Unknown config key',
      );
    });
  });

  describe('set', () => {
    it('sets a backend value', async () => {
      await runConfigSet(tmpDir, 'backend', 'github');
      const storage = Storage.create(tmpDir);
      try {
        const config = readConfigFromDb(storage.getDatabase());
        expect(config.backend).toBe('github');
      } finally {
        storage.destroy();
      }
    });

    it('validates backend values', async () => {
      await expect(runConfigSet(tmpDir, 'backend', 'foobar')).rejects.toThrow(
        'Invalid backend',
      );
    });

    it('accepts jira as a valid backend', async () => {
      await runConfigSet(tmpDir, 'backend', 'jira');
      const storage = Storage.create(tmpDir);
      try {
        const config = readConfigFromDb(storage.getDatabase());
        expect(config.backend).toBe('jira');
      } finally {
        storage.destroy();
      }
    });

    it('sets current_iteration', async () => {
      await runConfigSet(tmpDir, 'current_iteration', 'v2');
      const storage = Storage.create(tmpDir);
      try {
        const config = readConfigFromDb(storage.getDatabase());
        expect(config.current_iteration).toBe('v2');
      } finally {
        storage.destroy();
      }
    });
  });
});
