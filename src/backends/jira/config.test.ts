import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readJiraConfig } from './config.js';
import { configStore } from '../../stores/configStore.js';
import { createDatabase, type TicDatabase } from '../../storage/db.js';
import { Storage } from '../../storage/index.js';
import { updateConfig } from '../../storage/config.js';
import type { Config } from '../../storage/config.js';

describe('readJiraConfig', () => {
  let db: TicDatabase;

  beforeEach(() => {
    db = createDatabase(':memory:');
    Storage.createFromDb(db);
    configStore.getState().setDatabase(db);
  });

  afterEach(() => {
    configStore.getState().destroy();
    db.close();
  });

  it('reads jira config from configStore', async () => {
    updateConfig(db, {
      backend: 'jira',
      jira: {
        site: 'https://mycompany.atlassian.net',
        project: 'TEAM',
        boardId: 6,
      },
    });
    await configStore.getState().init('/fake/root');
    const config = await readJiraConfig('/fake/root');
    expect(config.site).toBe('https://mycompany.atlassian.net');
    expect(config.project).toBe('TEAM');
    expect(config.boardId).toBe(6);
  });

  it('throws when jira config is missing', async () => {
    updateConfig(db, { backend: 'jira' });
    await configStore.getState().init('/fake/root');
    await expect(readJiraConfig('/fake/root')).rejects.toThrow(
      'Jira backend requires "jira" configuration',
    );
  });

  it('throws when site is missing', async () => {
    updateConfig(db, {
      backend: 'jira',
      jira: { project: 'TEAM' } as unknown as Config['jira'],
    });
    await configStore.getState().init('/fake/root');
    await expect(readJiraConfig('/fake/root')).rejects.toThrow(
      'Jira backend requires "jira" configuration',
    );
  });

  it('throws when project is missing', async () => {
    updateConfig(db, {
      backend: 'jira',
      jira: { site: 'https://x.atlassian.net' } as unknown as Config['jira'],
    });
    await configStore.getState().init('/fake/root');
    await expect(readJiraConfig('/fake/root')).rejects.toThrow('jira.project');
  });

  it('allows boardId to be optional', async () => {
    updateConfig(db, {
      backend: 'jira',
      jira: {
        site: 'https://mycompany.atlassian.net',
        project: 'TEAM',
      },
    });
    await configStore.getState().init('/fake/root');
    const config = await readJiraConfig('/fake/root');
    expect(config.boardId).toBeUndefined();
  });
});
