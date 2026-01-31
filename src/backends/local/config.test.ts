import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readConfig, writeConfig, defaultConfig } from './config.js';

describe('config', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns default config when no config file exists', () => {
    const config = readConfig(tmpDir);
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

  it('reads existing config file', () => {
    const ticDir = path.join(tmpDir, '.tic');
    fs.mkdirSync(ticDir, { recursive: true });
    fs.writeFileSync(
      path.join(ticDir, 'config.yml'),
      'statuses:\n  - open\n  - closed\ncurrent_iteration: v1\niterations:\n  - v1\nnext_id: 5\n',
    );
    const config = readConfig(tmpDir);
    expect(config.statuses).toEqual(['open', 'closed']);
    expect(config.current_iteration).toBe('v1');
    expect(config.next_id).toBe(5);
  });

  it('writes config file and creates .tic dir', () => {
    writeConfig(tmpDir, { ...defaultConfig, next_id: 10 });
    const raw = fs.readFileSync(
      path.join(tmpDir, '.tic', 'config.yml'),
      'utf-8',
    );
    expect(raw).toContain('next_id: 10');
  });

  it('returns default config with types', () => {
    const config = readConfig(tmpDir);
    expect(config.types).toEqual(['epic', 'issue', 'task']);
  });

  it('reads config with custom types', () => {
    const ticDir = path.join(tmpDir, '.tic');
    fs.mkdirSync(ticDir, { recursive: true });
    fs.writeFileSync(
      path.join(ticDir, 'config.yml'),
      'types:\n  - story\n  - bug\nstatuses:\n  - open\ncurrent_iteration: v1\niterations:\n  - v1\nnext_id: 1\n',
    );
    const config = readConfig(tmpDir);
    expect(config.types).toEqual(['story', 'bug']);
  });

  it('returns default config with backend field', () => {
    const config = readConfig(tmpDir);
    expect(config.backend).toBe('local');
  });

  it('reads config with custom backend', () => {
    const ticDir = path.join(tmpDir, '.tic');
    fs.mkdirSync(ticDir, { recursive: true });
    fs.writeFileSync(
      path.join(ticDir, 'config.yml'),
      'backend: github\ntypes:\n  - task\nstatuses:\n  - open\ncurrent_iteration: v1\niterations:\n  - v1\nnext_id: 1\n',
    );
    const config = readConfig(tmpDir);
    expect(config.backend).toBe('github');
  });

  it('returns default config with branchMode', () => {
    const config = readConfig(tmpDir);
    expect(config.branchMode).toBe('worktree');
  });

  it('reads config with branchMode set to branch', () => {
    const ticDir = path.join(tmpDir, '.tic');
    fs.mkdirSync(ticDir, { recursive: true });
    fs.writeFileSync(
      path.join(ticDir, 'config.yml'),
      'branchMode: branch\nstatuses:\n  - open\ncurrent_iteration: v1\niterations:\n  - v1\nnext_id: 1\n',
    );
    const config = readConfig(tmpDir);
    expect(config.branchMode).toBe('branch');
  });
});
