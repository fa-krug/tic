import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JiraBackend } from './index.js';

vi.mock('./acli.js', () => ({
  acli: vi.fn(),
  acliExec: vi.fn(),
  acliExecSync: vi.fn(),
}));

vi.mock('./config.js', () => ({
  readJiraConfig: vi.fn(),
}));

import { acli, acliExec, acliExecSync } from './acli.js';
import { readJiraConfig } from './config.js';

const mockAcli = vi.mocked(acli);
const mockAcliExec = vi.mocked(acliExec);
const mockAcliExecSync = vi.mocked(acliExecSync);
const mockReadJiraConfig = vi.mocked(readJiraConfig);

function makeJiraIssue(overrides: {
  key: string;
  summary?: string;
  description?: string | null;
  status?: string;
  issuetype?: string;
  priority?: string | null;
  assignee?: { displayName: string; emailAddress: string } | null;
  labels?: string[];
  sprint?: { name: string } | null;
  created?: string;
  updated?: string;
  parent?: { key: string } | null;
  issuelinks?: {
    type: { name: string; inward: string; outward: string };
    inwardIssue?: { key: string };
    outwardIssue?: { key: string };
  }[];
}) {
  return {
    key: overrides.key,
    fields: {
      summary: overrides.summary ?? `Issue ${overrides.key}`,
      description: overrides.description ?? '',
      status: { name: overrides.status ?? 'To Do' },
      issuetype: { name: overrides.issuetype ?? 'Task' },
      priority:
        overrides.priority !== undefined
          ? overrides.priority
            ? { name: overrides.priority }
            : null
          : { name: 'Medium' },
      assignee: overrides.assignee ?? null,
      labels: overrides.labels ?? [],
      sprint: overrides.sprint ?? null,
      created: overrides.created ?? '2026-01-01T00:00:00.000+0000',
      updated: overrides.updated ?? '2026-01-02T00:00:00.000+0000',
      parent: overrides.parent ?? null,
      issuelinks: overrides.issuelinks ?? [],
    },
  };
}

describe('JiraBackend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAcliExecSync.mockReturnValue('');
    mockAcliExec.mockResolvedValue('');
    mockReadJiraConfig.mockResolvedValue({
      site: 'https://mycompany.atlassian.net',
      project: 'TEAM',
      boardId: 6,
    });
  });

  describe('create', () => {
    it('verifies acli auth on construction', async () => {
      await JiraBackend.create('/repo');
      expect(mockAcliExecSync).toHaveBeenCalledWith(
        ['jira', 'auth', 'status'],
        '/repo',
      );
    });

    it('throws when acli auth fails', async () => {
      mockAcliExecSync.mockImplementation(() => {
        throw new Error('not logged in');
      });
      await expect(JiraBackend.create('/repo')).rejects.toThrow();
    });
  });

  describe('getCapabilities', () => {
    it('returns Jira-specific capabilities', async () => {
      const backend = await JiraBackend.create('/repo');
      const caps = backend.getCapabilities();
      expect(caps.relationships).toBe(true);
      expect(caps.customTypes).toBe(false);
      expect(caps.customStatuses).toBe(false);
      expect(caps.iterations).toBe(true);
      expect(caps.comments).toBe(true);
      expect(caps.fields.priority).toBe(true);
      expect(caps.fields.assignee).toBe(true);
      expect(caps.fields.labels).toBe(true);
      expect(caps.fields.parent).toBe(true);
      expect(caps.fields.dependsOn).toBe(true);
    });

    it('disables iterations when boardId not configured', async () => {
      mockReadJiraConfig.mockResolvedValue({
        site: 'https://mycompany.atlassian.net',
        project: 'TEAM',
      });
      const backend = await JiraBackend.create('/repo');
      expect(backend.getCapabilities().iterations).toBe(false);
    });
  });

  describe('getStatuses', () => {
    it('returns statuses from project workflow', async () => {
      const backend = await JiraBackend.create('/repo');
      mockAcli.mockResolvedValue([
        { name: 'To Do' },
        { name: 'In Progress' },
        { name: 'Done' },
      ]);
      const statuses = await backend.getStatuses();
      expect(statuses).toEqual(['to do', 'in progress', 'done']);
    });
  });

  describe('getWorkItemTypes', () => {
    it('returns issue types from project config', async () => {
      const backend = await JiraBackend.create('/repo');
      mockAcli.mockResolvedValue({
        issueTypes: [
          { name: 'Epic' },
          { name: 'Story' },
          { name: 'Task' },
          { name: 'Bug' },
        ],
      });
      const types = await backend.getWorkItemTypes();
      expect(types).toEqual(['epic', 'story', 'task', 'bug']);
    });
  });

  describe('listWorkItems', () => {
    it('returns all issues mapped to WorkItems', async () => {
      const backend = await JiraBackend.create('/repo');
      mockAcli.mockResolvedValue([
        makeJiraIssue({
          key: 'TEAM-1',
          summary: 'First',
          status: 'To Do',
          assignee: { displayName: 'Alice', emailAddress: 'alice@example.com' },
          labels: ['bug'],
        }),
        makeJiraIssue({
          key: 'TEAM-2',
          summary: 'Second',
          status: 'Done',
        }),
      ]);

      const items = await backend.listWorkItems();
      expect(items).toHaveLength(2);
      expect(items[0]!.id).toBe('TEAM-1');
      expect(items[0]!.status).toBe('to do');
      expect(items[0]!.assignee).toBe('alice@example.com');
      expect(items[1]!.id).toBe('TEAM-2');
      expect(items[1]!.status).toBe('done');
    });

    it('filters by sprint when iteration provided', async () => {
      const backend = await JiraBackend.create('/repo');
      mockAcli
        .mockResolvedValueOnce([{ id: 42, name: 'Sprint 5', state: 'active' }])
        .mockResolvedValueOnce([
          makeJiraIssue({ key: 'TEAM-1', sprint: { name: 'Sprint 5' } }),
        ]);

      const items = await backend.listWorkItems('Sprint 5');
      expect(items).toHaveLength(1);
      expect(items[0]!.id).toBe('TEAM-1');
    });
  });

  describe('getWorkItem', () => {
    it('returns a single issue as WorkItem', async () => {
      const backend = await JiraBackend.create('/repo');
      mockAcli.mockResolvedValue(
        makeJiraIssue({
          key: 'TEAM-42',
          summary: 'The issue',
          assignee: { displayName: 'Bob', emailAddress: 'bob@example.com' },
          labels: ['feature'],
        }),
      );

      const item = await backend.getWorkItem('TEAM-42');
      expect(item.id).toBe('TEAM-42');
      expect(item.title).toBe('The issue');
      expect(item.assignee).toBe('bob@example.com');
    });
  });

  describe('createWorkItem', () => {
    it('creates an issue and returns the WorkItem', async () => {
      const backend = await JiraBackend.create('/repo');
      mockAcli.mockResolvedValueOnce({ key: 'TEAM-10' }).mockResolvedValueOnce(
        makeJiraIssue({
          key: 'TEAM-10',
          summary: 'New issue',
          issuetype: 'Task',
        }),
      );

      const item = await backend.createWorkItem({
        title: 'New issue',
        type: 'task',
        status: 'to do',
        iteration: '',
        priority: 'medium',
        assignee: '',
        labels: [],
        description: 'Description',
        parent: null,
        dependsOn: [],
      });

      expect(item.id).toBe('TEAM-10');
    });

    it('sets parent when specified', async () => {
      const backend = await JiraBackend.create('/repo');
      mockAcli
        .mockResolvedValueOnce({ key: 'TEAM-11' })
        .mockResolvedValueOnce(
          makeJiraIssue({ key: 'TEAM-11', parent: { key: 'TEAM-5' } }),
        );

      await backend.createWorkItem({
        title: 'Child issue',
        type: 'task',
        status: 'to do',
        iteration: '',
        priority: 'medium',
        assignee: '',
        labels: [],
        description: '',
        parent: 'TEAM-5',
        dependsOn: [],
      });

      expect(mockAcli).toHaveBeenCalledWith(
        expect.arrayContaining(['--parent', 'TEAM-5']),
        '/repo',
      );
    });

    it('creates dependency links when dependsOn specified', async () => {
      const backend = await JiraBackend.create('/repo');
      mockAcli.mockResolvedValueOnce({ key: 'TEAM-12' });
      mockAcliExec.mockResolvedValue('');
      mockAcli.mockResolvedValueOnce(
        makeJiraIssue({
          key: 'TEAM-12',
          issuelinks: [
            {
              type: {
                name: 'Blocks',
                inward: 'is blocked by',
                outward: 'blocks',
              },
              inwardIssue: { key: 'TEAM-3' },
            },
          ],
        }),
      );

      await backend.createWorkItem({
        title: 'Blocked issue',
        type: 'task',
        status: 'to do',
        iteration: '',
        priority: 'medium',
        assignee: '',
        labels: [],
        description: '',
        parent: null,
        dependsOn: ['TEAM-3'],
      });

      expect(mockAcliExec).toHaveBeenCalledWith(
        expect.arrayContaining([
          'jira',
          'workitem',
          'link',
          'create',
          '--out',
          'TEAM-3',
          '--in',
          'TEAM-12',
          '--type',
          'Blocks',
        ]),
        '/repo',
      );
    });

    it('rolls back created issue when dependency link creation fails', async () => {
      const backend = await JiraBackend.create('/repo');
      mockAcli.mockResolvedValueOnce({ key: 'TEAM-42' });
      mockAcliExec
        .mockRejectedValueOnce(new Error('link creation failed'))
        .mockResolvedValueOnce('');

      await expect(
        backend.createWorkItem({
          title: 'Issue with deps',
          type: 'task',
          status: 'to do',
          iteration: '',
          priority: 'medium',
          assignee: '',
          labels: [],
          description: '',
          parent: null,
          dependsOn: ['TEAM-1'],
        }),
      ).rejects.toThrow('Failed to create dependency links');

      expect(mockAcliExec).toHaveBeenCalledWith(
        ['jira', 'workitem', 'delete', '--key', 'TEAM-42', '--yes'],
        '/repo',
      );
    });
  });

  describe('updateWorkItem', () => {
    it('updates title via edit command', async () => {
      const backend = await JiraBackend.create('/repo');
      mockAcliExec.mockResolvedValue('');
      mockAcli.mockResolvedValue(
        makeJiraIssue({ key: 'TEAM-5', summary: 'Updated title' }),
      );

      const item = await backend.updateWorkItem('TEAM-5', {
        title: 'Updated title',
      });

      expect(item.title).toBe('Updated title');
      expect(mockAcliExec).toHaveBeenCalledWith(
        expect.arrayContaining([
          'jira',
          'workitem',
          'edit',
          '--key',
          'TEAM-5',
          '--summary',
          'Updated title',
        ]),
        '/repo',
      );
    });

    it('transitions status via separate command', async () => {
      const backend = await JiraBackend.create('/repo');
      mockAcliExec.mockResolvedValue('');
      mockAcli.mockResolvedValue(
        makeJiraIssue({ key: 'TEAM-5', status: 'Done' }),
      );

      await backend.updateWorkItem('TEAM-5', { status: 'done' });

      expect(mockAcliExec).toHaveBeenCalledWith(
        expect.arrayContaining([
          'jira',
          'workitem',
          'transition',
          '--key',
          'TEAM-5',
          '--status',
          'Done',
        ]),
        '/repo',
      );
    });

    it('assigns via separate command', async () => {
      const backend = await JiraBackend.create('/repo');
      mockAcliExec.mockResolvedValue('');
      mockAcli.mockResolvedValue(
        makeJiraIssue({
          key: 'TEAM-5',
          assignee: { displayName: 'Alice', emailAddress: 'alice@example.com' },
        }),
      );

      await backend.updateWorkItem('TEAM-5', { assignee: 'alice@example.com' });

      expect(mockAcliExec).toHaveBeenCalledWith(
        expect.arrayContaining([
          'jira',
          'workitem',
          'assign',
          '--key',
          'TEAM-5',
          '--assignee',
          'alice@example.com',
        ]),
        '/repo',
      );
    });
  });

  describe('deleteWorkItem', () => {
    it('deletes a work item', async () => {
      const backend = await JiraBackend.create('/repo');
      mockAcliExec.mockResolvedValue('');
      await backend.deleteWorkItem('TEAM-7');
      expect(mockAcliExec).toHaveBeenCalledWith(
        ['jira', 'workitem', 'delete', '--key', 'TEAM-7', '--yes'],
        '/repo',
      );
    });
  });

  describe('addComment', () => {
    it('adds a comment and returns it', async () => {
      const backend = await JiraBackend.create('/repo');
      mockAcliExec.mockResolvedValue('');

      const comment = await backend.addComment('TEAM-3', {
        author: 'alice@example.com',
        body: 'This is a comment.',
      });

      expect(mockAcliExec).toHaveBeenCalledWith(
        [
          'jira',
          'workitem',
          'comment',
          'create',
          '--key',
          'TEAM-3',
          '--body',
          'This is a comment.',
        ],
        '/repo',
      );
      expect(comment.author).toBe('alice@example.com');
      expect(comment.body).toBe('This is a comment.');
    });
  });

  describe('getChildren', () => {
    it('returns items whose parent matches the given id', async () => {
      const backend = await JiraBackend.create('/repo');
      mockAcli.mockResolvedValue([
        makeJiraIssue({ key: 'TEAM-2', parent: { key: 'TEAM-1' } }),
        makeJiraIssue({ key: 'TEAM-3', parent: { key: 'TEAM-1' } }),
      ]);

      const children = await backend.getChildren('TEAM-1');
      expect(children).toHaveLength(2);
    });
  });

  describe('getDependents', () => {
    it('returns items that depend on the given id', async () => {
      const backend = await JiraBackend.create('/repo');
      mockAcli.mockResolvedValue([
        makeJiraIssue({
          key: 'TEAM-5',
          issuelinks: [
            {
              type: {
                name: 'Blocks',
                inward: 'is blocked by',
                outward: 'blocks',
              },
              inwardIssue: { key: 'TEAM-3' },
            },
          ],
        }),
      ]);

      const dependents = await backend.getDependents('TEAM-3');
      expect(dependents).toHaveLength(1);
      expect(dependents[0]!.id).toBe('TEAM-5');
    });
  });

  describe('getItemUrl', () => {
    it('returns the Jira browse URL', async () => {
      const backend = await JiraBackend.create('/repo');
      expect(backend.getItemUrl('TEAM-42')).toBe(
        'https://mycompany.atlassian.net/browse/TEAM-42',
      );
    });
  });

  describe('openItem', () => {
    it('opens the issue in the browser', async () => {
      const backend = await JiraBackend.create('/repo');
      mockAcliExec.mockResolvedValue('');
      await backend.openItem('TEAM-5');
      expect(mockAcliExec).toHaveBeenCalledWith(
        ['jira', 'workitem', 'view', 'TEAM-5', '--web'],
        '/repo',
      );
    });
  });

  describe('getIterations', () => {
    it('returns sprint names from board', async () => {
      const backend = await JiraBackend.create('/repo');
      mockAcli.mockResolvedValue([
        { id: 1, name: 'Sprint 1', state: 'closed' },
        { id: 2, name: 'Sprint 2', state: 'active' },
        { id: 3, name: 'Sprint 3', state: 'future' },
      ]);
      const iterations = await backend.getIterations();
      expect(iterations).toEqual(['Sprint 1', 'Sprint 2', 'Sprint 3']);
    });

    it('returns empty array when no boardId', async () => {
      mockReadJiraConfig.mockResolvedValue({
        site: 'https://mycompany.atlassian.net',
        project: 'TEAM',
      });
      const backend = await JiraBackend.create('/repo');
      expect(await backend.getIterations()).toEqual([]);
    });
  });

  describe('getAssignees', () => {
    it('returns unique assignee emails', async () => {
      const backend = await JiraBackend.create('/repo');
      mockAcli.mockResolvedValue([
        { displayName: 'Alice', emailAddress: 'alice@example.com' },
        { displayName: 'Bob', emailAddress: 'bob@example.com' },
      ]);
      const assignees = await backend.getAssignees();
      expect(assignees).toContain('alice@example.com');
      expect(assignees).toContain('bob@example.com');
    });

    it('returns empty array on error', async () => {
      const backend = await JiraBackend.create('/repo');
      mockAcli.mockRejectedValue(new Error('API error'));
      expect(await backend.getAssignees()).toEqual([]);
    });
  });

  describe('setCurrentIteration', () => {
    it('is a no-op', async () => {
      const backend = await JiraBackend.create('/repo');
      await expect(
        backend.setCurrentIteration('Sprint 5'),
      ).resolves.not.toThrow();
    });
  });

  describe('getCurrentIteration', () => {
    it('returns active sprint name', async () => {
      const backend = await JiraBackend.create('/repo');
      mockAcli.mockResolvedValue([
        { id: 2, name: 'Sprint 2', state: 'active' },
      ]);
      expect(await backend.getCurrentIteration()).toBe('Sprint 2');
    });

    it('returns empty string when no active sprint', async () => {
      const backend = await JiraBackend.create('/repo');
      mockAcli.mockResolvedValue([]);
      expect(await backend.getCurrentIteration()).toBe('');
    });
  });
});
