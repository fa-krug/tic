import { describe, it, expect } from 'vitest';
import { buildUpdateCommand, buildRelaunchArgs } from './updater.js';

describe('updater', () => {
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
