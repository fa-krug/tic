import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { LocalBackend } from '../../backends/local/index.js';
import { handleInitProject, handleGetConfig } from '../commands/mcp.js';

describe('MCP handlers', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-mcp-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  let backend: LocalBackend;

  describe('handleInitProject', () => {
    it('initializes a new project', () => {
      const result = handleInitProject(tmpDir);
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0]!.text) as {
        alreadyExists: boolean;
      };
      expect(data.alreadyExists).toBe(false);
      expect(fs.existsSync(path.join(tmpDir, '.tic', 'config.yml'))).toBe(true);
    });

    it('returns alreadyExists for existing project', () => {
      handleInitProject(tmpDir);
      const result = handleInitProject(tmpDir);
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0]!.text) as {
        alreadyExists: boolean;
      };
      expect(data.alreadyExists).toBe(true);
    });
  });

  describe('handleGetConfig', () => {
    it('returns config from backend', () => {
      handleInitProject(tmpDir);
      backend = new LocalBackend(tmpDir);
      const result = handleGetConfig(backend);
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0]!.text) as {
        statuses: string[];
        types: string[];
        iterations: string[];
        currentIteration: string;
      };
      expect(data.statuses).toEqual([
        'backlog',
        'todo',
        'in-progress',
        'review',
        'done',
      ]);
      expect(data.types).toEqual(['epic', 'issue', 'task']);
      expect(data.iterations).toEqual(['default']);
      expect(data.currentIteration).toBe('default');
    });
  });
});
