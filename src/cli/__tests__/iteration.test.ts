import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { LocalBackend } from '../../backends/local/index.js';
import { runIterationList, runIterationSet } from '../commands/iteration.js';

describe('iteration commands', () => {
  let tmpDir: string;
  let backend: LocalBackend;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-cli-test-'));
    backend = new LocalBackend(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  describe('runIterationList', () => {
    it('returns default iterations', () => {
      const result = runIterationList(backend);
      expect(result.iterations).toEqual(['default']);
      expect(result.current).toBe('default');
    });
  });

  describe('runIterationSet', () => {
    it('sets current iteration', () => {
      runIterationSet(backend, 'sprint-1');
      expect(backend.getCurrentIteration()).toBe('sprint-1');
    });

    it('adds new iteration if it does not exist', () => {
      runIterationSet(backend, 'sprint-2');
      expect(backend.getIterations()).toContain('sprint-2');
    });
  });
});
