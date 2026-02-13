import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AzureDevOpsBackend } from './index.js';

const mockApi = {
  rest: vi.fn(),
  wiql: vi.fn(),
  batchGetWorkItems: vi.fn(),
  paginate: vi.fn(),
};

vi.mock('./api.js', () => {
  // Use a real class to satisfy `new AdoApiClient()`
  return {
    AdoApiClient: class MockAdoApiClient {
      rest = mockApi.rest;
      wiql = mockApi.wiql;
      batchGetWorkItems = mockApi.batchGetWorkItems;
      paginate = mockApi.paginate;
    },
  };
});

vi.mock('../../auth/ado.js', () => ({
  getAdoToken: vi.fn().mockReturnValue('test-bearer-token'),
  getAdoPat: vi.fn().mockReturnValue(null),
  authenticateAdo: vi.fn(),
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

import { execFileSync } from 'node:child_process';

const mockExecFileSync = vi.mocked(execFileSync);

const sampleTypes = [
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
];

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

async function makeBackend(): Promise<AzureDevOpsBackend> {
  // The create() factory calls api.rest for work item types
  mockApi.rest.mockResolvedValueOnce({ value: sampleTypes });
  return AzureDevOpsBackend.create('/repo');
}

describe('AzureDevOpsBackend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('creates backend and fetches work item types', async () => {
      const backend = await makeBackend();
      expect(backend).toBeInstanceOf(AzureDevOpsBackend);
      // Verify it fetched work item types
      expect(mockApi.rest).toHaveBeenCalledWith(
        'GET',
        '/WebApp/_apis/wit/workitemtypes',
      );
    });
  });

  describe('getCapabilities', () => {
    it('returns ADO-specific capabilities', async () => {
      const backend = await makeBackend();
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
    it('returns the union of all states across types', async () => {
      const backend = await makeBackend();
      const statuses = await backend.getStatuses();
      expect(statuses).toContain('New');
      expect(statuses).toContain('Active');
      expect(statuses).toContain('Resolved');
      expect(statuses).toContain('Closed');
      // No duplicates
      expect(new Set(statuses).size).toBe(statuses.length);
    });
  });

  describe('getWorkItemTypes', () => {
    it('returns types from ADO project', async () => {
      const backend = await makeBackend();
      expect(await backend.getWorkItemTypes()).toEqual([
        'Epic',
        'User Story',
        'Task',
      ]);
    });
  });

  describe('getIterations', () => {
    it('returns iteration paths', async () => {
      const backend = await makeBackend();
      mockApi.rest.mockResolvedValueOnce({
        value: [{ path: 'WebApp\\Sprint 1' }, { path: 'WebApp\\Sprint 2' }],
      });
      expect(await backend.getIterations()).toEqual([
        'WebApp\\Sprint 1',
        'WebApp\\Sprint 2',
      ]);
    });
  });

  describe('getCurrentIteration', () => {
    it('returns the current iteration path', async () => {
      const backend = await makeBackend();
      mockApi.rest.mockResolvedValueOnce({
        value: [{ path: 'WebApp\\Sprint 1' }],
      });
      expect(await backend.getCurrentIteration()).toBe('WebApp\\Sprint 1');
    });

    it('returns empty string when no current iteration', async () => {
      const backend = await makeBackend();
      mockApi.rest.mockResolvedValueOnce({ value: [] });
      expect(await backend.getCurrentIteration()).toBe('');
    });
  });

  describe('setCurrentIteration', () => {
    it('is a no-op', async () => {
      const backend = await makeBackend();
      await expect(
        backend.setCurrentIteration('Sprint 1'),
      ).resolves.not.toThrow();
    });
  });

  describe('listWorkItems', () => {
    it('uses WIQL query and batch fetch', async () => {
      const backend = await makeBackend();

      // WIQL returns workItems array
      mockApi.wiql.mockResolvedValueOnce({
        workItems: [{ id: 42 }, { id: 43 }],
      });

      // Batch fetch returns full items
      mockApi.batchGetWorkItems.mockResolvedValueOnce({
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

      const items = await backend.listWorkItems();
      expect(items).toHaveLength(2);
      // Sorted by updated descending
      expect(items[0]!.id).toBe('42');
      expect(items[1]!.id).toBe('43');
    });

    it('filters by iteration via WIQL', async () => {
      const backend = await makeBackend();

      mockApi.wiql.mockResolvedValueOnce({
        workItems: [{ id: 42 }],
      });
      mockApi.batchGetWorkItems.mockResolvedValueOnce({
        value: [sampleWorkItem],
      });

      await backend.listWorkItems('WebApp\\Sprint 1');

      // Verify WIQL query contains iteration filter
      const wiqlCall = mockApi.wiql.mock.calls[0]!;
      expect(wiqlCall[1]).toContain('System.IterationPath');
    });

    it('returns empty array when no items match', async () => {
      const backend = await makeBackend();
      mockApi.wiql.mockResolvedValueOnce({ workItems: [] });
      expect(await backend.listWorkItems()).toEqual([]);
    });
  });

  describe('getWorkItem', () => {
    it('returns a work item with comments', async () => {
      const backend = await makeBackend();

      // rest call for work item
      mockApi.rest.mockResolvedValueOnce(sampleWorkItem);
      // rest call for comments
      mockApi.rest.mockResolvedValueOnce({
        comments: [sampleComment],
      });

      const item = await backend.getWorkItem('42');
      expect(item.id).toBe('42');
      expect(item.title).toBe('Fix login bug');
      expect(item.comments).toHaveLength(1);
      expect(item.comments[0]!.author).toBe('Bob');
    });
  });

  describe('createWorkItem', () => {
    it('creates a work item with JSON Patch and returns it', async () => {
      const backend = await makeBackend();

      // Create call returns the new item
      mockApi.rest.mockResolvedValueOnce({ ...sampleWorkItem, id: 99 });
      // getWorkItem refetch: work item + comments
      mockApi.rest.mockResolvedValueOnce({ ...sampleWorkItem, id: 99 });
      mockApi.rest.mockResolvedValueOnce({ comments: [] });

      const item = await backend.createWorkItem({
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

      // Verify the create call used JSON Patch
      const createCall = mockApi.rest.mock.calls[1]!; // [0] was types fetch
      expect(createCall[0]).toBe('POST');
      expect(createCall[1]).toContain('_apis/wit/workitems/$User%20Story');
      expect(createCall[3]).toBe('application/json-patch+json');

      // Verify patch body contains title
      const patchBody = createCall[2] as Array<{
        op: string;
        path: string;
        value: unknown;
      }>;
      expect(patchBody).toContainEqual({
        op: 'add',
        path: '/fields/System.Title',
        value: 'New item',
      });
    });

    it('includes parent and dependency relations in create request', async () => {
      const backend = await makeBackend();

      mockApi.rest.mockResolvedValueOnce({ ...sampleWorkItem, id: 99 });
      // getWorkItem refetch
      mockApi.rest.mockResolvedValueOnce({ ...sampleWorkItem, id: 99 });
      mockApi.rest.mockResolvedValueOnce({ comments: [] });

      await backend.createWorkItem({
        title: 'New item',
        type: 'Task',
        status: 'New',
        iteration: '',
        priority: 'medium',
        assignee: '',
        labels: [],
        description: '',
        parent: '10',
        dependsOn: ['20', '21'],
      });

      const createCall = mockApi.rest.mock.calls[1]!;
      const patchBody = createCall[2] as Array<{
        op: string;
        path: string;
        value: unknown;
      }>;

      // Should have parent relation
      expect(patchBody).toContainEqual({
        op: 'add',
        path: '/relations/-',
        value: {
          rel: 'System.LinkTypes.Hierarchy-Reverse',
          url: 'https://dev.azure.com/contoso/_apis/wit/workitems/10',
        },
      });

      // Should have dependency relations
      expect(patchBody).toContainEqual({
        op: 'add',
        path: '/relations/-',
        value: {
          rel: 'System.LinkTypes.Dependency-Reverse',
          url: 'https://dev.azure.com/contoso/_apis/wit/workitems/20',
        },
      });
      expect(patchBody).toContainEqual({
        op: 'add',
        path: '/relations/-',
        value: {
          rel: 'System.LinkTypes.Dependency-Reverse',
          url: 'https://dev.azure.com/contoso/_apis/wit/workitems/21',
        },
      });
    });
  });

  describe('updateWorkItem', () => {
    it('updates work item fields via JSON Patch', async () => {
      const backend = await makeBackend();

      // PATCH call
      mockApi.rest.mockResolvedValueOnce(undefined);
      // getWorkItem refetch: work item + comments
      mockApi.rest.mockResolvedValueOnce({
        ...sampleWorkItem,
        fields: { ...sampleWorkItem.fields, 'System.Title': 'Updated' },
      });
      mockApi.rest.mockResolvedValueOnce({ comments: [] });

      await backend.updateWorkItem('42', { title: 'Updated' });

      const patchCall = mockApi.rest.mock.calls[1]!;
      expect(patchCall[0]).toBe('PATCH');
      expect(patchCall[1]).toContain('_apis/wit/workitems/42');
      expect(patchCall[3]).toBe('application/json-patch+json');

      const patchBody = patchCall[2] as Array<{
        op: string;
        path: string;
        value: unknown;
      }>;
      expect(patchBody).toContainEqual({
        op: 'replace',
        path: '/fields/System.Title',
        value: 'Updated',
      });
    });

    it('updates parent relation via JSON Patch', async () => {
      const backend = await makeBackend();

      // Fetch current item with relations (for parent diff)
      mockApi.rest.mockResolvedValueOnce({
        ...sampleWorkItem,
        relations: [
          {
            rel: 'System.LinkTypes.Hierarchy-Reverse',
            url: 'https://dev.azure.com/contoso/_apis/wit/workItems/10',
            attributes: {},
          },
        ],
      });
      // PATCH call
      mockApi.rest.mockResolvedValueOnce(undefined);
      // getWorkItem refetch: work item + comments
      mockApi.rest.mockResolvedValueOnce(sampleWorkItem);
      mockApi.rest.mockResolvedValueOnce({ comments: [] });

      await backend.updateWorkItem('42', { parent: '20' });

      // Find the PATCH call
      const patchCall = mockApi.rest.mock.calls.find(
        (c) =>
          c[0] === 'PATCH' &&
          (c[1] as string).includes('_apis/wit/workitems/42'),
      )!;
      const patchBody = patchCall[2] as Array<{
        op: string;
        path: string;
        value?: unknown;
      }>;

      // Should remove old parent (index 0)
      expect(patchBody).toContainEqual({
        op: 'remove',
        path: '/relations/0',
      });

      // Should add new parent (20)
      expect(patchBody).toContainEqual({
        op: 'add',
        path: '/relations/-',
        value: {
          rel: 'System.LinkTypes.Hierarchy-Reverse',
          url: 'https://dev.azure.com/contoso/_apis/wit/workitems/20',
        },
      });
    });

    it('clears parent relation when set to null', async () => {
      const backend = await makeBackend();

      // Fetch current item with existing parent
      mockApi.rest.mockResolvedValueOnce({
        ...sampleWorkItem,
        relations: [
          {
            rel: 'System.LinkTypes.Hierarchy-Reverse',
            url: 'https://dev.azure.com/contoso/_apis/wit/workItems/10',
            attributes: {},
          },
        ],
      });
      // PATCH call
      mockApi.rest.mockResolvedValueOnce(undefined);
      // getWorkItem refetch
      mockApi.rest.mockResolvedValueOnce({
        ...sampleWorkItem,
        relations: [],
      });
      mockApi.rest.mockResolvedValueOnce({ comments: [] });

      await backend.updateWorkItem('42', { parent: null });

      const patchCall = mockApi.rest.mock.calls.find(
        (c) =>
          c[0] === 'PATCH' &&
          (c[1] as string).includes('_apis/wit/workitems/42'),
      )!;
      const patchBody = patchCall[2] as Array<{
        op: string;
        path: string;
        value?: unknown;
      }>;

      // Should remove old parent
      expect(patchBody).toContainEqual({
        op: 'remove',
        path: '/relations/0',
      });
    });

    it('updates dependency relations via JSON Patch', async () => {
      const backend = await makeBackend();

      // Fetch current item with existing deps [20, 21]
      mockApi.rest.mockResolvedValueOnce({
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
      // PATCH call
      mockApi.rest.mockResolvedValueOnce(undefined);
      // getWorkItem refetch
      mockApi.rest.mockResolvedValueOnce(sampleWorkItem);
      mockApi.rest.mockResolvedValueOnce({ comments: [] });

      // Change deps to [21, 30] — remove 20, keep 21, add 30
      await backend.updateWorkItem('42', { dependsOn: ['21', '30'] });

      const patchCall = mockApi.rest.mock.calls.find(
        (c) =>
          c[0] === 'PATCH' &&
          (c[1] as string).includes('_apis/wit/workitems/42'),
      )!;
      const patchBody = patchCall[2] as Array<{
        op: string;
        path: string;
        value?: unknown;
      }>;

      // Should remove dep 20 (index 0)
      expect(patchBody).toContainEqual({
        op: 'remove',
        path: '/relations/0',
      });

      // Should add dep 30
      expect(patchBody).toContainEqual({
        op: 'add',
        path: '/relations/-',
        value: {
          rel: 'System.LinkTypes.Dependency-Reverse',
          url: 'https://dev.azure.com/contoso/_apis/wit/workitems/30',
        },
      });
    });
  });

  describe('deleteWorkItem', () => {
    it('deletes a work item', async () => {
      const backend = await makeBackend();
      mockApi.rest.mockResolvedValueOnce(undefined);

      await backend.deleteWorkItem('42');

      expect(mockApi.rest).toHaveBeenCalledWith(
        'DELETE',
        '/_apis/wit/workitems/42',
      );
    });
  });

  describe('addComment', () => {
    it('adds a comment and returns it', async () => {
      const backend = await makeBackend();
      mockApi.rest.mockResolvedValueOnce(sampleComment);

      const comment = await backend.addComment('42', {
        author: 'Alice',
        body: 'A comment.',
      });

      expect(comment.author).toBe('Alice');
      expect(comment.body).toBe('A comment.');

      // Verify it used the comments API with preview version
      const commentCall = mockApi.rest.mock.calls[1]!;
      expect(commentCall[0]).toBe('POST');
      expect(commentCall[1]).toContain('/comments?api-version=7.1-preview.4');
    });
  });

  describe('getChildren', () => {
    it('returns child work items via WIQL link query', async () => {
      const backend = await makeBackend();

      // Link queries return workItemRelations (not flat workItems)
      mockApi.wiql.mockResolvedValueOnce({
        workItemRelations: [
          { target: { id: 42 }, source: null },
          { target: { id: 50 }, source: { id: 42 } },
          { target: { id: 51 }, source: { id: 42 } },
        ],
      });
      mockApi.batchGetWorkItems.mockResolvedValueOnce({
        value: [
          { ...sampleWorkItem, id: 50 },
          { ...sampleWorkItem, id: 51 },
        ],
      });

      const children = await backend.getChildren('42');
      expect(children).toHaveLength(2);
    });

    it('returns empty array when no children', async () => {
      const backend = await makeBackend();
      mockApi.wiql.mockResolvedValueOnce({
        workItemRelations: [{ target: { id: 42 }, source: null }],
      });
      expect(await backend.getChildren('42')).toEqual([]);
    });
  });

  describe('getDependents', () => {
    it('returns dependent work items via WIQL link query', async () => {
      const backend = await makeBackend();

      mockApi.wiql.mockResolvedValueOnce({
        workItemRelations: [
          { target: { id: 42 }, source: null },
          { target: { id: 60 }, source: { id: 42 } },
        ],
      });
      mockApi.batchGetWorkItems.mockResolvedValueOnce({
        value: [{ ...sampleWorkItem, id: 60 }],
      });

      const dependents = await backend.getDependents('42');
      expect(dependents).toHaveLength(1);
    });
  });

  describe('getItemUrl', () => {
    it('returns the ADO web URL for a work item', async () => {
      const backend = await makeBackend();
      const url = backend.getItemUrl('42');
      expect(url).toBe(
        'https://dev.azure.com/contoso/WebApp/_workitems/edit/42',
      );
    });
  });

  describe('openItem', () => {
    it('opens the work item URL in the browser', async () => {
      const backend = await makeBackend();
      mockExecFileSync.mockReturnValue('');

      await backend.openItem('42');

      expect(mockExecFileSync).toHaveBeenCalledWith('open', [
        'https://dev.azure.com/contoso/WebApp/_workitems/edit/42',
      ]);
    });
  });

  describe('getAssignees', () => {
    it('returns team member display names', async () => {
      const backend = await makeBackend();
      mockApi.rest.mockResolvedValueOnce({
        value: [
          { identity: { displayName: 'Alice Smith' } },
          { identity: { displayName: 'Bob Jones' } },
        ],
      });
      expect(await backend.getAssignees()).toEqual([
        'Alice Smith',
        'Bob Jones',
      ]);
    });

    it('filters out entries with null/undefined identity', async () => {
      const backend = await makeBackend();
      mockApi.rest.mockResolvedValueOnce({
        value: [
          { identity: { displayName: 'Alice Smith' } },
          { identity: null },
          { identity: undefined },
          { identity: { displayName: 'Bob Jones' } },
        ],
      });
      expect(await backend.getAssignees()).toEqual([
        'Alice Smith',
        'Bob Jones',
      ]);
    });

    it('returns empty array on error', async () => {
      const backend = await makeBackend();
      mockApi.rest.mockRejectedValueOnce(new Error('API error'));
      expect(await backend.getAssignees()).toEqual([]);
    });
  });
});
