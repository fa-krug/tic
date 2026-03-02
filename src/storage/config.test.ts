import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase, type TicDatabase } from './db.js';
import { Storage } from './index.js';
import { readConfig, writeConfig, updateConfig } from './config.js';
import type { Config } from './config.js';

describe('drizzle config', () => {
  let db: TicDatabase;
  let backend: Storage;

  beforeEach(() => {
    db = createDatabase(':memory:');
    backend = Storage.createFromDb(db);
  });

  afterEach(() => {
    backend.destroy();
  });

  it('reads default config from fresh database', () => {
    const config = readConfig(db);

    expect(config.backend).toBe('drizzle');
    expect(config.statuses).toEqual([
      'backlog',
      'todo',
      'in-progress',
      'review',
      'done',
    ]);
    expect(config.types).toEqual(['epic', 'issue', 'task']);
    expect(config.current_iteration).toBe('default');
    expect(config.iterations).toEqual(['default']);
    expect(config.next_id).toBe(1);
    expect(config.branchMode).toBe('worktree');
    expect(config.autoUpdate).toBe(true);
    expect(config.copyToClipboard).toBe(true);
  });

  it('updates individual config fields', () => {
    updateConfig(db, { branchMode: 'branch', autoUpdate: false });

    const config = readConfig(db);
    expect(config.branchMode).toBe('branch');
    expect(config.autoUpdate).toBe(false);
    // Other fields remain unchanged
    expect(config.statuses).toEqual([
      'backlog',
      'todo',
      'in-progress',
      'review',
      'done',
    ]);
  });

  it('reads and writes statuses with sort order', () => {
    const customStatuses = ['open', 'wip', 'review', 'done', 'closed'];
    updateConfig(db, { statuses: customStatuses });

    const config = readConfig(db);
    expect(config.statuses).toEqual(customStatuses);
  });

  it('reads and writes types with sort order', () => {
    const customTypes = ['story', 'bug', 'chore', 'spike'];
    updateConfig(db, { types: customTypes });

    const config = readConfig(db);
    expect(config.types).toEqual(customTypes);
  });

  it('reads and writes iterations with sort order', () => {
    const customIterations = ['sprint-1', 'sprint-2', 'sprint-3'];
    updateConfig(db, { iterations: customIterations });

    const config = readConfig(db);
    expect(config.iterations).toEqual(customIterations);
  });

  it('reads and writes saved views with filters and sort entries', () => {
    const views = [
      {
        name: 'My bugs',
        filters: {
          statuses: ['open', 'in-progress'],
          types: ['bug'],
          priorities: ['high', 'critical'],
        },
        sort: [
          { column: 'priority', direction: 'asc' },
          { column: 'created', direction: 'desc' },
        ],
      },
      {
        name: 'Tasks only',
        filters: {
          types: ['task'],
        },
      },
    ];

    updateConfig(db, { views });

    const config = readConfig(db);
    expect(config.views).toBeDefined();
    expect(config.views).toHaveLength(2);

    const bugsView = config.views!.find((v) => v.name === 'My bugs');
    expect(bugsView).toBeDefined();
    expect(bugsView!.filters.statuses).toEqual(['open', 'in-progress']);
    expect(bugsView!.filters.types).toEqual(['bug']);
    expect(bugsView!.filters.priorities).toEqual(['high', 'critical']);
    expect(bugsView!.sort).toEqual([
      { column: 'priority', direction: 'asc' },
      { column: 'created', direction: 'desc' },
    ]);

    const tasksView = config.views!.find((v) => v.name === 'Tasks only');
    expect(tasksView).toBeDefined();
    expect(tasksView!.filters.types).toEqual(['task']);
    expect(tasksView!.sort).toBeUndefined();
  });

  it('reads and writes jira config', () => {
    updateConfig(db, {
      jira: {
        site: 'mycompany.atlassian.net',
        project: 'PROJ',
        boardId: 42,
      },
    });

    const config = readConfig(db);
    expect(config.jira).toBeDefined();
    expect(config.jira!.site).toBe('mycompany.atlassian.net');
    expect(config.jira!.project).toBe('PROJ');
    expect(config.jira!.boardId).toBe(42);
  });

  it('updateConfig merges partial config correctly', () => {
    // First set some non-default values
    writeConfig(db, {
      backend: 'drizzle',
      statuses: ['open', 'closed'],
      types: ['bug', 'feature'],
      current_iteration: 'sprint-1',
      iterations: ['sprint-1', 'sprint-2'],
      next_id: 10,
      branchMode: 'branch',
      autoUpdate: false,
      branchCommand: 'echo hello',
      copyToClipboard: false,
    });

    // Now partial update only statuses
    updateConfig(db, {
      statuses: ['new', 'done'],
    });

    const config = readConfig(db);
    // Updated fields
    expect(config.statuses).toEqual(['new', 'done']);
    // next_id is NOT overwritten by config updates — it is managed
    // atomically by Storage.createWorkItem() to prevent stale values.
    // seedDefaults() set it to 1, and writeConfig/updateConfig preserve
    // the DB value on conflict updates.
    expect(config.next_id).toBe(1);
    // Unchanged fields
    expect(config.types).toEqual(['bug', 'feature']);
    expect(config.current_iteration).toBe('sprint-1');
    expect(config.iterations).toEqual(['sprint-1', 'sprint-2']);
    expect(config.branchMode).toBe('branch');
    expect(config.autoUpdate).toBe(false);
    expect(config.branchCommand).toBe('echo hello');
    expect(config.copyToClipboard).toBe(false);
  });

  it('writeConfig is idempotent', () => {
    const config = readConfig(db);

    // Write the same config twice
    writeConfig(db, config);
    const afterFirst = readConfig(db);

    writeConfig(db, afterFirst);
    const afterSecond = readConfig(db);

    expect(afterFirst).toEqual(afterSecond);
  });

  it('jira is undefined when site is empty', () => {
    // Default fresh DB has no jira config row, so jira should be undefined
    const config = readConfig(db);
    expect(config.jira).toBeUndefined();
  });

  it('jira becomes undefined after clearing', () => {
    // First set jira config
    updateConfig(db, {
      jira: {
        site: 'test.atlassian.net',
        project: 'TEST',
      },
    });

    let config = readConfig(db);
    expect(config.jira).toBeDefined();

    // Now write config without jira (undefined)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { jira: _jira, ...rest } = config;
    writeConfig(db, { ...rest } as unknown as Config);

    config = readConfig(db);
    expect(config.jira).toBeUndefined();
  });

  it('handles jira config without boardId', () => {
    updateConfig(db, {
      jira: {
        site: 'mycompany.atlassian.net',
        project: 'PROJ',
      },
    });

    const config = readConfig(db);
    expect(config.jira).toBeDefined();
    expect(config.jira!.site).toBe('mycompany.atlassian.net');
    expect(config.jira!.project).toBe('PROJ');
    expect(config.jira!.boardId).toBeUndefined();
  });

  it('handles optional fields correctly', () => {
    updateConfig(db, {
      defaultType: 'task',
      showDetailPanel: true,
      branchCommand: 'git checkout -b',
      defaultView: 'My View',
    });

    const config = readConfig(db);
    expect(config.defaultType).toBe('task');
    expect(config.showDetailPanel).toBe(true);
    expect(config.branchCommand).toBe('git checkout -b');
    expect(config.defaultView).toBe('My View');
  });

  it('views are undefined when none exist', () => {
    const config = readConfig(db);
    expect(config.views).toBeUndefined();
  });

  it('preserves view filter field types (assignees, labels)', () => {
    const views = [
      {
        name: 'Team view',
        filters: {
          assignees: ['alice', 'bob'],
          labels: ['frontend', 'urgent'],
        },
      },
    ];

    updateConfig(db, { views });

    const config = readConfig(db);
    expect(config.views).toHaveLength(1);
    expect(config.views![0]!.filters.assignees).toEqual(['alice', 'bob']);
    expect(config.views![0]!.filters.labels).toEqual(['frontend', 'urgent']);
  });
});
