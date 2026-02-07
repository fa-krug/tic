import { describe, it, expect } from 'vitest';
import {
  buildUpdateCommand,
  buildRelaunchArgs,
  isUpdateRequested,
  requestUpdate,
} from './updater.js';

describe('updater', () => {
  describe('update signal', () => {
    it('isUpdateRequested returns false by default', () => {
      expect(isUpdateRequested()).toBe(false);
    });

    it('returns true after requestUpdate', () => {
      requestUpdate();
      expect(isUpdateRequested()).toBe(true);
    });
  });

  describe('buildUpdateCommand', () => {
    it('returns npm install command for the package', () => {
      const cmd = buildUpdateCommand();
      expect(cmd).toBe('npm install -g @sascha384/tic@latest');
    });
  });

  describe('buildRelaunchArgs', () => {
    it('returns tic binary with original args', () => {
      const args = buildRelaunchArgs(['--json', 'item', 'list']);
      expect(args).toEqual({
        command: 'tic',
        args: ['--json', 'item', 'list'],
      });
    });

    it('returns tic binary with empty args', () => {
      const args = buildRelaunchArgs([]);
      expect(args).toEqual({ command: 'tic', args: [] });
    });
  });
});
