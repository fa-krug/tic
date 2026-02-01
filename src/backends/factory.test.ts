import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createBackend, detectBackend, VALID_BACKENDS } from './factory.js';
import { writeConfig, defaultConfig } from './local/config.js';

describe('VALID_BACKENDS', () => {
  it('contains the four known backends', () => {
    expect(VALID_BACKENDS).toEqual(['local', 'github', 'gitlab', 'azure']);
  });
});

describe('detectBackend', () => {
  it('returns local when git remote fails', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-detect-'));
    const result = detectBackend(tmpDir);
    expect(result).toBe('local');
    fs.rmSync(tmpDir, { recursive: true });
  });
});

describe('createBackend', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-factory-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('creates a LocalBackend when backend is local', () => {
    writeConfig(tmpDir, { ...defaultConfig, backend: 'local' });
    const backend = createBackend(tmpDir);
    expect(backend.getStatuses()).toEqual(defaultConfig.statuses);
  });

  it('attempts to create GitHubBackend when backend is github', () => {
    writeConfig(tmpDir, { ...defaultConfig, backend: 'github' });
    // Throws because gh auth will fail in test env, but NOT "not yet implemented"
    expect(() => createBackend(tmpDir)).not.toThrow('not yet implemented');
  });

  it('attempts to create GitLabBackend when backend is gitlab', () => {
    writeConfig(tmpDir, { ...defaultConfig, backend: 'gitlab' });
    // Throws because glab auth will fail in test env, but NOT "not yet implemented"
    expect(() => createBackend(tmpDir)).not.toThrow('not yet implemented');
  });

  it(
    'attempts to create AzureDevOpsBackend when backend is azure',
    { timeout: 20_000 },
    () => {
      writeConfig(tmpDir, { ...defaultConfig, backend: 'azure' });
      // Throws because az auth will fail in test env, but NOT "not yet implemented"
      expect(() => createBackend(tmpDir)).not.toThrow('not yet implemented');
    },
  );

  it('throws for unknown backend values', () => {
    writeConfig(tmpDir, { ...defaultConfig, backend: 'jira' });
    expect(() => createBackend(tmpDir)).toThrow('Unknown backend');
  });
});
