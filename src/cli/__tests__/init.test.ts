import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runInit } from '../commands/init.js';
import { requireTicProject } from '../index.js';
import { readConfig } from '../../backends/local/config.js';

describe('tic init', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-cli-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('creates .tic directory with config.yml', () => {
    const result = runInit(tmpDir);
    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.tic', 'config.yml'))).toBe(true);
  });

  it('writes backend field to config on init', () => {
    runInit(tmpDir, 'local');
    const config = readConfig(tmpDir);
    expect(config.backend).toBe('local');
  });

  it('writes chosen backend to config', () => {
    runInit(tmpDir, 'github');
    const config = readConfig(tmpDir);
    expect(config.backend).toBe('github');
  });

  it('defaults to local when no backend specified', () => {
    runInit(tmpDir);
    const config = readConfig(tmpDir);
    expect(config.backend).toBe('local');
  });

  it('returns already-initialized message if .tic exists', () => {
    fs.mkdirSync(path.join(tmpDir, '.tic'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.tic', 'config.yml'), 'next_id: 1\n');
    const result = runInit(tmpDir);
    expect(result.alreadyExists).toBe(true);
  });
});

describe('requireTicProject', () => {
  it('throws when .tic directory does not exist', () => {
    const emptyDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'tic-cli-noproject-'),
    );
    expect(() => requireTicProject(emptyDir)).toThrow(
      "Not a tic project (no .tic/ directory found). Run 'tic init' first.",
    );
    fs.rmSync(emptyDir, { recursive: true });
  });

  it('does not throw when .tic directory exists', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-cli-project-'));
    fs.mkdirSync(path.join(dir, '.tic'), { recursive: true });
    expect(() => requireTicProject(dir)).not.toThrow();
    fs.rmSync(dir, { recursive: true });
  });
});
