import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { LocalBackend } from '../../backends/local/index.js';
import { runIterationList, runIterationSet } from '../commands/iteration.js';

describe('iteration commands', () => {
  let tmpDir: string;
  let backend: LocalBackend;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-cli-test-'));
    backend = await LocalBackend.create(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  describe('runIterationList', () => {
    it('returns default iterations', async () => {
      const result = await runIterationList(backend);
      expect(result.iterations).toEqual(['default']);
      expect(result.current).toBe('default');
    });
  });

  describe('runIterationSet', () => {
    it('sets current iteration', async () => {
      await runIterationSet(backend, 'sprint-1');
      expect(await backend.getCurrentIteration()).toBe('sprint-1');
    });

    it('adds new iteration if it does not exist', async () => {
      await runIterationSet(backend, 'sprint-2');
      expect(await backend.getIterations()).toContain('sprint-2');
    });
  });
});
