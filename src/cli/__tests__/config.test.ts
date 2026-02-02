import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runConfigGet, runConfigSet } from '../commands/config.js';
import {
  writeConfig,
  defaultConfig,
  readConfig,
} from '../../backends/local/config.js';

describe('tic config', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-config-test-'));
    await writeConfig(tmpDir, { ...defaultConfig });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  describe('get', () => {
    it('returns the value of a config key', async () => {
      const value = await runConfigGet(tmpDir, 'backend');
      expect(value).toBe('local');
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
      const config = await readConfig(tmpDir);
      expect(config.backend).toBe('github');
    });

    it('validates backend values', async () => {
      await expect(runConfigSet(tmpDir, 'backend', 'foobar')).rejects.toThrow(
        'Invalid backend',
      );
    });

    it('accepts jira as a valid backend', async () => {
      await runConfigSet(tmpDir, 'backend', 'jira');
      const config = await readConfig(tmpDir);
      expect(config.backend).toBe('jira');
    });

    it('sets current_iteration', async () => {
      await runConfigSet(tmpDir, 'current_iteration', 'v2');
      const config = await readConfig(tmpDir);
      expect(config.current_iteration).toBe('v2');
    });
  });
});
