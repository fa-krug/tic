import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  readConfig,
  writeConfig,
  defaultConfig,
  readConfigSync,
} from './config.js';

describe('config', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns default config when no config file exists', async () => {
    const config = await readConfig(tmpDir);
    expect(config.statuses).toEqual([
      'backlog',
      'todo',
      'in-progress',
      'review',
      'done',
    ]);
    expect(config.current_iteration).toBe('default');
    expect(config.iterations).toEqual(['default']);
    expect(config.next_id).toBe(1);
  });

  it('reads existing config file', async () => {
    const ticDir = path.join(tmpDir, '.tic');
    fs.mkdirSync(ticDir, { recursive: true });
    fs.writeFileSync(
      path.join(ticDir, 'config.yml'),
      'statuses:\n  - open\n  - closed\ncurrent_iteration: v1\niterations:\n  - v1\nnext_id: 5\n',
    );
    const config = await readConfig(tmpDir);
    expect(config.statuses).toEqual(['open', 'closed']);
    expect(config.current_iteration).toBe('v1');
    expect(config.next_id).toBe(5);
  });

  it('writes config file and creates .tic dir', async () => {
    await writeConfig(tmpDir, { ...defaultConfig, next_id: 10 });
    const raw = fs.readFileSync(
      path.join(tmpDir, '.tic', 'config.yml'),
      'utf-8',
    );
    expect(raw).toContain('next_id: 10');
  });

  it('returns default config with types', async () => {
    const config = await readConfig(tmpDir);
    expect(config.types).toEqual(['epic', 'issue', 'task']);
  });

  it('reads config with custom types', async () => {
    const ticDir = path.join(tmpDir, '.tic');
    fs.mkdirSync(ticDir, { recursive: true });
    fs.writeFileSync(
      path.join(ticDir, 'config.yml'),
      'types:\n  - story\n  - bug\nstatuses:\n  - open\ncurrent_iteration: v1\niterations:\n  - v1\nnext_id: 1\n',
    );
    const config = await readConfig(tmpDir);
    expect(config.types).toEqual(['story', 'bug']);
  });

  it('returns default config with backend field', async () => {
    const config = await readConfig(tmpDir);
    expect(config.backend).toBe('local');
  });

  it('reads config with custom backend', async () => {
    const ticDir = path.join(tmpDir, '.tic');
    fs.mkdirSync(ticDir, { recursive: true });
    fs.writeFileSync(
      path.join(ticDir, 'config.yml'),
      'backend: github\ntypes:\n  - task\nstatuses:\n  - open\ncurrent_iteration: v1\niterations:\n  - v1\nnext_id: 1\n',
    );
    const config = await readConfig(tmpDir);
    expect(config.backend).toBe('github');
  });

  it('returns default config with branchMode', async () => {
    const config = await readConfig(tmpDir);
    expect(config.branchMode).toBe('worktree');
  });

  it('reads config with branchMode set to branch', async () => {
    const ticDir = path.join(tmpDir, '.tic');
    fs.mkdirSync(ticDir, { recursive: true });
    fs.writeFileSync(
      path.join(ticDir, 'config.yml'),
      'branchMode: branch\nstatuses:\n  - open\ncurrent_iteration: v1\niterations:\n  - v1\nnext_id: 1\n',
    );
    const config = await readConfig(tmpDir);
    expect(config.branchMode).toBe('branch');
  });

  it('returns default config with autoUpdate true', async () => {
    const config = await readConfig(tmpDir);
    expect(config.autoUpdate).toBe(true);
  });

  it('reads config with autoUpdate set to false', async () => {
    const ticDir = path.join(tmpDir, '.tic');
    fs.mkdirSync(ticDir, { recursive: true });
    fs.writeFileSync(
      path.join(ticDir, 'config.yml'),
      'autoUpdate: false\nstatuses:\n  - open\ncurrent_iteration: v1\niterations:\n  - v1\nnext_id: 1\n',
    );
    const config = await readConfig(tmpDir);
    expect(config.autoUpdate).toBe(false);
  });

  it('returns default config with no defaultType', async () => {
    const config = await readConfig(tmpDir);
    expect(config.defaultType).toBeUndefined();
  });

  it('reads config with defaultType', async () => {
    const ticDir = path.join(tmpDir, '.tic');
    fs.mkdirSync(ticDir, { recursive: true });
    fs.writeFileSync(
      path.join(ticDir, 'config.yml'),
      'defaultType: task\nstatuses:\n  - open\ncurrent_iteration: v1\niterations:\n  - v1\nnext_id: 1\n',
    );
    const config = await readConfig(tmpDir);
    expect(config.defaultType).toBe('task');
  });

  describe('readConfigSync', () => {
    it('returns default config when no config file exists', () => {
      const config = readConfigSync(tmpDir);
      expect(config.statuses).toEqual([
        'backlog',
        'todo',
        'in-progress',
        'review',
        'done',
      ]);
      expect(config.next_id).toBe(1);
    });

    it('reads existing config file synchronously', () => {
      const ticDir = path.join(tmpDir, '.tic');
      fs.mkdirSync(ticDir, { recursive: true });
      fs.writeFileSync(
        path.join(ticDir, 'config.yml'),
        'statuses:\n  - open\n  - closed\ncurrent_iteration: v1\niterations:\n  - v1\nnext_id: 5\n',
      );
      const config = readConfigSync(tmpDir);
      expect(config.statuses).toEqual(['open', 'closed']);
      expect(config.next_id).toBe(5);
    });
  });
});
