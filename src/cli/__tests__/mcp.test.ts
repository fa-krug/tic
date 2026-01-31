import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { handleInitProject } from '../commands/mcp.js';

describe('MCP handlers', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-mcp-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

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
});
