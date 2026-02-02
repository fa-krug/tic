import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readJiraConfig } from './config.js';
import { writeConfig, defaultConfig, type Config } from '../local/config.js';

describe('readJiraConfig', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-jira-config-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('reads jira config from .tic/config.yml', async () => {
    await writeConfig(tmpDir, {
      ...defaultConfig,
      backend: 'jira',
      jira: {
        site: 'https://mycompany.atlassian.net',
        project: 'TEAM',
        boardId: 6,
      },
    });
    const config = await readJiraConfig(tmpDir);
    expect(config.site).toBe('https://mycompany.atlassian.net');
    expect(config.project).toBe('TEAM');
    expect(config.boardId).toBe(6);
  });

  it('throws when jira config is missing', async () => {
    await writeConfig(tmpDir, { ...defaultConfig, backend: 'jira' });
    await expect(readJiraConfig(tmpDir)).rejects.toThrow(
      'Jira backend requires "jira" configuration',
    );
  });

  it('throws when site is missing', async () => {
    const config = {
      ...defaultConfig,
      backend: 'jira',
      jira: { project: 'TEAM' },
    } as unknown as Config;
    await writeConfig(tmpDir, config);
    await expect(readJiraConfig(tmpDir)).rejects.toThrow('jira.site');
  });

  it('throws when project is missing', async () => {
    const config = {
      ...defaultConfig,
      backend: 'jira',
      jira: { site: 'https://x.atlassian.net' },
    } as unknown as Config;
    await writeConfig(tmpDir, config);
    await expect(readJiraConfig(tmpDir)).rejects.toThrow('jira.project');
  });

  it('allows boardId to be optional', async () => {
    await writeConfig(tmpDir, {
      ...defaultConfig,
      backend: 'jira',
      jira: {
        site: 'https://mycompany.atlassian.net',
        project: 'TEAM',
      },
    });
    const config = await readJiraConfig(tmpDir);
    expect(config.boardId).toBeUndefined();
  });
});
