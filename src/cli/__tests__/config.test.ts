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

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-config-test-'));
    writeConfig(tmpDir, { ...defaultConfig });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  describe('get', () => {
    it('returns the value of a config key', () => {
      const value = runConfigGet(tmpDir, 'backend');
      expect(value).toBe('local');
    });

    it('returns current_iteration', () => {
      const value = runConfigGet(tmpDir, 'current_iteration');
      expect(value).toBe('default');
    });

    it('throws for unknown keys', () => {
      expect(() => runConfigGet(tmpDir, 'nonexistent')).toThrow(
        'Unknown config key',
      );
    });
  });

  describe('set', () => {
    it('sets a backend value', () => {
      runConfigSet(tmpDir, 'backend', 'github');
      const config = readConfig(tmpDir);
      expect(config.backend).toBe('github');
    });

    it('validates backend values', () => {
      expect(() => runConfigSet(tmpDir, 'backend', 'jira')).toThrow(
        'Invalid backend',
      );
    });

    it('sets current_iteration', () => {
      runConfigSet(tmpDir, 'current_iteration', 'v2');
      const config = readConfig(tmpDir);
      expect(config.current_iteration).toBe('v2');
    });
  });
});
