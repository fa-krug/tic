import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AzureDevOpsBackend } from './index.js';

vi.mock('./az.js', () => ({
  az: vi.fn(),
  azExec: vi.fn(),
  azInvoke: vi.fn(),
}));

vi.mock('./remote.js', () => ({
  parseAdoRemote: vi.fn().mockReturnValue({
    org: 'contoso',
    project: 'WebApp',
  }),
}));

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
  execSync: vi.fn(),
}));

import { az, azExec, azInvoke } from './az.js';
import { execFileSync } from 'node:child_process';

const mockAz = vi.mocked(az);
const mockAzExec = vi.mocked(azExec);
const mockAzInvoke = vi.mocked(azInvoke);
const mockExecFileSync = vi.mocked(execFileSync);

function makeBackend(): AzureDevOpsBackend {
  return new AzureDevOpsBackend('/repo');
}

const sampleWorkItem = {
  id: 42,
  fields: {
    'System.Title': 'Fix login bug',
    'System.WorkItemType': 'User Story',
    'System.State': 'Active',
    'System.IterationPath': 'WebApp\\Sprint 1',
    'Microsoft.VSTS.Common.Priority': 2,
    'System.AssignedTo': {
      displayName: 'Alice',
      uniqueName: 'alice@contoso.com',
    },
    'System.Tags': 'bug; frontend',
    'System.Description': '<p>Login breaks.</p>',
    'System.CreatedDate': '2026-01-15T10:00:00Z',
    'System.ChangedDate': '2026-01-20T14:30:00Z',
  },
  relations: [
    {
      rel: 'System.LinkTypes.Hierarchy-Reverse',
      url: 'https://dev.azure.com/contoso/_apis/wit/workItems/10',
      attributes: {},
    },
  ],
};

const sampleComment = {
  createdBy: { displayName: 'Bob' },
  createdDate: '2026-01-16T09:00:00Z',
  text: '<p>Reproduced.</p>',
};

describe('AzureDevOpsBackend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Constructor calls azExec for auth check
    mockAzExec.mockReturnValue('');
    // Constructor calls azInvoke for work item types
    mockAzInvoke.mockReturnValue({
      value: [
        {
          name: 'Epic',
          states: [{ name: 'New' }, { name: 'Active' }, { name: 'Closed' }],
        },
        {
          name: 'User Story',
          states: [
            { name: 'New' },
            { name: 'Active' },
            { name: 'Resolved' },
            { name: 'Closed' },
          ],
        },
        {
          name: 'Task',
          states: [{ name: 'New' }, { name: 'Active' }, { name: 'Closed' }],
        },
      ],
    });
  });

  describe('constructor', () => {
    it('verifies az auth on construction', () => {
      makeBackend();
      expect(mockAzExec).toHaveBeenCalledWith(['account', 'show'], '/repo');
    });

    it('throws when az auth fails', () => {
      mockAzExec.mockImplementation(() => {
        throw new Error('Please run az login');
      });
      expect(() => makeBackend()).toThrow();
    });
  });

  describe('getCapabilities', () => {
    it('returns ADO-specific capabilities', () => {
      const backend = makeBackend();
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
  });

  describe('getStatuses', () => {
    it('returns the union of all states across types', () => {
      const backend = makeBackend();
      const statuses = backend.getStatuses();
      expect(statuses).toContain('New');
      expect(statuses).toContain('Active');
      expect(statuses).toContain('Resolved');
      expect(statuses).toContain('Closed');
      // No duplicates
      expect(new Set(statuses).size).toBe(statuses.length);
    });
  });

  describe('getWorkItemTypes', () => {
    it('returns types from ADO project', () => {
      const backend = makeBackend();
      expect(backend.getWorkItemTypes()).toEqual([
        'Epic',
        'User Story',
        'Task',
      ]);
    });
  });

  describe('getIterations', () => {
    it('returns iteration paths', () => {
      const backend = makeBackend();
      mockAz.mockReturnValueOnce([
        {
          name: 'Sprint 1',
          path: 'WebApp\\Sprint 1',
          attributes: { startDate: '2026-01-01', finishDate: '2026-01-14' },
        },
        {
          name: 'Sprint 2',
          path: 'WebApp\\Sprint 2',
          attributes: { startDate: '2026-01-15', finishDate: '2026-01-28' },
        },
      ]);
      expect(backend.getIterations()).toEqual([
        'WebApp\\Sprint 1',
        'WebApp\\Sprint 2',
      ]);
    });
  });

  describe('getCurrentIteration', () => {
    it('returns the current iteration path', () => {
      const backend = makeBackend();
      mockAz.mockReturnValueOnce([
        {
          name: 'Sprint 1',
          path: 'WebApp\\Sprint 1',
          attributes: {
            startDate: '2026-01-01T00:00:00Z',
            finishDate: '2030-12-31T00:00:00Z',
          },
        },
      ]);
      expect(backend.getCurrentIteration()).toBe('WebApp\\Sprint 1');
    });

    it('returns empty string when no current iteration', () => {
      const backend = makeBackend();
      mockAz.mockReturnValueOnce([]);
      expect(backend.getCurrentIteration()).toBe('');
    });
  });

  describe('setCurrentIteration', () => {
    it('is a no-op', () => {
      const backend = makeBackend();
      expect(() => backend.setCurrentIteration('Sprint 1')).not.toThrow();
    });
  });

  describe('listWorkItems', () => {
    it('uses WIQL query and batch fetch', () => {
      const backend = makeBackend();

      // WIQL query returns flat array of items
      mockAz.mockReturnValueOnce([{ id: 42 }, { id: 43 }]);

      // Batch fetch returns full items
      mockAzInvoke.mockReturnValueOnce({
        value: [
          { ...sampleWorkItem, id: 42 },
          {
            ...sampleWorkItem,
            id: 43,
            fields: {
              ...sampleWorkItem.fields,
              'System.ChangedDate': '2026-01-19T00:00:00Z',
            },
          },
        ],
      });

      const items = backend.listWorkItems();
      expect(items).toHaveLength(2);
      // Sorted by updated descending
      expect(items[0]!.id).toBe('42');
      expect(items[1]!.id).toBe('43');
      // Verify batch fetch includes $expand for relations (call[0] is constructor's workitemtypes)
      const invokeCall = mockAzInvoke.mock.calls[1]!;
      const invokeOpts = invokeCall[0] as { body: { $expand: number } };
      expect(invokeOpts.body.$expand).toBe(4);
    });

    it('filters by iteration via WIQL', () => {
      const backend = makeBackend();

      mockAz.mockReturnValueOnce([{ id: 42 }]);
      mockAzInvoke.mockReturnValueOnce({
        value: [sampleWorkItem],
      });

      backend.listWorkItems('WebApp\\Sprint 1');

      expect(mockAz).toHaveBeenCalledWith(
        expect.arrayContaining(['boards', 'query', '--wiql']),
        '/repo',
      );
      // Verify WIQL contains iteration filter
      const wiqlCall = mockAz.mock.calls.find((c) => c[0].includes('--wiql'));
      const wiqlArg = wiqlCall?.[0][wiqlCall[0].indexOf('--wiql') + 1];
      expect(wiqlArg).toContain('System.IterationPath');
    });

    it('returns empty array when no items match', () => {
      const backend = makeBackend();
      mockAz.mockReturnValueOnce([]);
      expect(backend.listWorkItems()).toEqual([]);
    });
  });

  describe('getWorkItem', () => {
    it('returns a work item with comments', () => {
      const backend = makeBackend();

      mockAz.mockReturnValueOnce(sampleWorkItem);
      mockAzInvoke.mockReturnValueOnce({
        comments: [sampleComment],
      });

      const item = backend.getWorkItem('42');
      expect(item.id).toBe('42');
      expect(item.title).toBe('Fix login bug');
      expect(item.comments).toHaveLength(1);
      expect(item.comments[0]!.author).toBe('Bob');
    });
  });

  describe('createWorkItem', () => {
    it('creates a work item and returns it', () => {
      const backend = makeBackend();

      mockAz.mockReturnValueOnce({ ...sampleWorkItem, id: 99 });
      // getWorkItem refetch
      mockAz.mockReturnValueOnce({ ...sampleWorkItem, id: 99 });
      mockAzInvoke.mockReturnValueOnce({ comments: [] });

      const item = backend.createWorkItem({
        title: 'New item',
        type: 'User Story',
        status: 'New',
        iteration: 'WebApp\\Sprint 1',
        priority: 'high',
        assignee: 'Alice',
        labels: ['bug'],
        description: 'Description',
        parent: null,
        dependsOn: [],
      });

      expect(item.id).toBe('99');
      expect(mockAz).toHaveBeenCalledWith(
        expect.arrayContaining([
          'boards',
          'work-item',
          'create',
          '--type',
          'User Story',
          '--title',
          'New item',
        ]),
        '/repo',
      );
    });
  });

  describe('updateWorkItem', () => {
    it('updates work item fields', () => {
      const backend = makeBackend();

      mockAz.mockReturnValueOnce(sampleWorkItem);
      // getWorkItem refetch
      mockAz.mockReturnValueOnce({
        ...sampleWorkItem,
        fields: { ...sampleWorkItem.fields, 'System.Title': 'Updated' },
      });
      mockAzInvoke.mockReturnValueOnce({ comments: [] });

      backend.updateWorkItem('42', { title: 'Updated' });

      expect(mockAz).toHaveBeenCalledWith(
        expect.arrayContaining(['boards', 'work-item', 'update', '--id', '42']),
        '/repo',
      );
    });

    it('updates parent relation', () => {
      const backend = makeBackend();

      // Fetch current item with relations (for parent diff)
      mockAz.mockReturnValueOnce({
        ...sampleWorkItem,
        relations: [
          {
            rel: 'System.LinkTypes.Hierarchy-Reverse',
            url: 'https://dev.azure.com/contoso/_apis/wit/workItems/10',
            attributes: {},
          },
        ],
      });
      mockAzExec.mockReturnValue('');
      // getWorkItem refetch
      mockAz.mockReturnValueOnce(sampleWorkItem);
      mockAzInvoke.mockReturnValueOnce({ comments: [] });

      backend.updateWorkItem('42', { parent: '20' });

      // Should remove old parent (10)
      expect(mockAzExec).toHaveBeenCalledWith(
        expect.arrayContaining([
          'relation',
          'remove',
          '--id',
          '42',
          '--target-id',
          '10',
        ]),
        '/repo',
      );
      // Should add new parent (20)
      expect(mockAzExec).toHaveBeenCalledWith(
        expect.arrayContaining([
          'relation',
          'add',
          '--id',
          '42',
          '--target-id',
          '20',
        ]),
        '/repo',
      );
    });

    it('clears parent relation when set to null', () => {
      const backend = makeBackend();

      // Fetch current item with existing parent
      mockAz.mockReturnValueOnce({
        ...sampleWorkItem,
        relations: [
          {
            rel: 'System.LinkTypes.Hierarchy-Reverse',
            url: 'https://dev.azure.com/contoso/_apis/wit/workItems/10',
            attributes: {},
          },
        ],
      });
      mockAzExec.mockReturnValue('');
      // getWorkItem refetch
      mockAz.mockReturnValueOnce({ ...sampleWorkItem, relations: [] });
      mockAzInvoke.mockReturnValueOnce({ comments: [] });

      backend.updateWorkItem('42', { parent: null });

      // Should remove old parent
      expect(mockAzExec).toHaveBeenCalledWith(
        expect.arrayContaining(['relation', 'remove', '--target-id', '10']),
        '/repo',
      );
    });

    it('updates dependency relations', () => {
      const backend = makeBackend();

      // Fetch current item with existing deps [20, 21]
      mockAz.mockReturnValueOnce({
        ...sampleWorkItem,
        relations: [
          {
            rel: 'System.LinkTypes.Dependency-Reverse',
            url: 'https://dev.azure.com/contoso/_apis/wit/workItems/20',
            attributes: {},
          },
          {
            rel: 'System.LinkTypes.Dependency-Reverse',
            url: 'https://dev.azure.com/contoso/_apis/wit/workItems/21',
            attributes: {},
          },
        ],
      });
      mockAzExec.mockReturnValue('');
      // getWorkItem refetch
      mockAz.mockReturnValueOnce(sampleWorkItem);
      mockAzInvoke.mockReturnValueOnce({ comments: [] });

      // Change deps to [21, 30] — remove 20, keep 21, add 30
      backend.updateWorkItem('42', { dependsOn: ['21', '30'] });

      // Should remove 20
      expect(mockAzExec).toHaveBeenCalledWith(
        expect.arrayContaining(['relation', 'remove', '--target-id', '20']),
        '/repo',
      );
      // Should add 30
      expect(mockAzExec).toHaveBeenCalledWith(
        expect.arrayContaining(['relation', 'add', '--target-id', '30']),
        '/repo',
      );
    });
  });

  describe('deleteWorkItem', () => {
    it('deletes a work item', () => {
      const backend = makeBackend();
      mockAzExec.mockReturnValue('');

      backend.deleteWorkItem('42');

      expect(mockAzExec).toHaveBeenCalledWith(
        expect.arrayContaining([
          'boards',
          'work-item',
          'delete',
          '--id',
          '42',
          '--yes',
        ]),
        '/repo',
      );
    });
  });

  describe('addComment', () => {
    it('adds a comment and returns it', () => {
      const backend = makeBackend();
      mockAzInvoke.mockReturnValueOnce(sampleComment);

      const comment = backend.addComment('42', {
        author: 'Alice',
        body: 'A comment.',
      });

      expect(comment.author).toBe('Alice');
      expect(comment.body).toBe('A comment.');
    });
  });

  describe('getChildren', () => {
    it('returns child work items via WIQL', () => {
      const backend = makeBackend();

      // Link queries include the source item; code filters it out
      mockAz.mockReturnValueOnce([{ id: 42 }, { id: 50 }, { id: 51 }]);
      mockAzInvoke.mockReturnValueOnce({
        value: [
          { ...sampleWorkItem, id: 50 },
          { ...sampleWorkItem, id: 51 },
        ],
      });

      const children = backend.getChildren('42');
      expect(children).toHaveLength(2);
    });

    it('returns empty array when no children', () => {
      const backend = makeBackend();
      mockAz.mockReturnValueOnce([]);
      expect(backend.getChildren('42')).toEqual([]);
    });
  });

  describe('getDependents', () => {
    it('returns dependent work items via WIQL', () => {
      const backend = makeBackend();

      // Link queries include the source item; code filters it out
      mockAz.mockReturnValueOnce([{ id: 42 }, { id: 60 }]);
      mockAzInvoke.mockReturnValueOnce({
        value: [{ ...sampleWorkItem, id: 60 }],
      });

      const dependents = backend.getDependents('42');
      expect(dependents).toHaveLength(1);
    });
  });

  describe('getItemUrl', () => {
    it('returns the ADO web URL for a work item', () => {
      const backend = makeBackend();
      const url = backend.getItemUrl('42');
      expect(url).toBe(
        'https://dev.azure.com/contoso/WebApp/_workitems/edit/42',
      );
    });
  });

  describe('openItem', () => {
    it('opens the work item URL in the browser', () => {
      const backend = makeBackend();
      mockExecFileSync.mockReturnValue('');

      backend.openItem('42');

      expect(mockExecFileSync).toHaveBeenCalledWith('open', [
        'https://dev.azure.com/contoso/WebApp/_workitems/edit/42',
      ]);
    });
  });

  describe('getAssignees', () => {
    it('returns team member display names', () => {
      const backend = makeBackend();
      mockAz.mockReturnValueOnce([
        { identity: { displayName: 'Alice Smith' } },
        { identity: { displayName: 'Bob Jones' } },
      ]);
      expect(backend.getAssignees()).toEqual(['Alice Smith', 'Bob Jones']);
    });

    it('returns empty array on error', () => {
      const backend = makeBackend();
      mockAz.mockImplementationOnce(() => {
        throw new Error('API error');
      });
      expect(backend.getAssignees()).toEqual([]);
    });
  });
});
