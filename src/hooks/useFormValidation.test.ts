import { describe, it, expect } from 'vitest';
import type { WorkItem } from '../types.js';
import { validateFormFields } from './useFormValidation.js';

function makeItem(
  overrides: Partial<WorkItem> & { rowId: number; id: string },
): WorkItem {
  return {
    title: `Item ${overrides.id}`,
    type: 'task',
    status: 'open',
    iteration: '',
    priority: 'medium',
    assignee: '',
    labels: [],
    created: '2024-01-01',
    updated: '2024-01-01',
    description: '',
    comments: [],
    parent: null,
    dependsOn: [],
    ...overrides,
  };
}

const items: WorkItem[] = [
  makeItem({ rowId: 1, id: '1' }),
  makeItem({ rowId: 2, id: '2', parent: 1 }),
  makeItem({ rowId: 3, id: '3', parent: 2 }),
  makeItem({ rowId: 4, id: '4', dependsOn: [1] }),
];

describe('validateFormFields', () => {
  describe('required fields', () => {
    it('returns error when title is empty', () => {
      const errors = validateFormFields(
        { title: '', parentId: '', dependsOn: '' },
        items,
        null,
        ['title'],
      );
      expect(errors['title']).toBe('Title is required');
    });

    it('returns no error when title is set', () => {
      const errors = validateFormFields(
        { title: 'My item', parentId: '', dependsOn: '' },
        items,
        null,
        ['title'],
      );
      expect(errors['title']).toBeUndefined();
    });

    it('checks custom required fields from capabilities', () => {
      const errors = validateFormFields(
        { title: 'My item', parentId: '', dependsOn: '' },
        items,
        null,
        ['title', 'priority', 'assignee'],
        { priority: '', assignee: '' },
      );
      expect(errors['priority']).toBe('Priority is required');
      expect(errors['assignee']).toBe('Assignee is required');
    });

    it('no error for custom required fields when values provided', () => {
      const errors = validateFormFields(
        { title: 'My item', parentId: '', dependsOn: '' },
        items,
        null,
        ['title', 'priority'],
        { priority: 'high' },
      );
      expect(errors['priority']).toBeUndefined();
    });
  });

  describe('parent validation', () => {
    it('returns no error when parent is empty', () => {
      const errors = validateFormFields(
        { title: 'Test', parentId: '', dependsOn: '' },
        items,
        null,
        ['title'],
      );
      expect(errors['parentId']).toBeUndefined();
    });

    it('returns error when parent does not exist', () => {
      const errors = validateFormFields(
        { title: 'Test', parentId: '#99 - Missing', dependsOn: '' },
        items,
        null,
        ['title'],
      );
      expect(errors['parentId']).toBe('Parent #99 does not exist');
    });

    it('returns error for self-reference', () => {
      const errors = validateFormFields(
        { title: 'Test', parentId: '#1 - Item 1', dependsOn: '' },
        items,
        '1',
        ['title'],
      );
      expect(errors['parentId']).toBe('Cannot be its own parent');
    });

    it('returns error for circular parent chain', () => {
      // Item 3 has parent 2, which has parent 1.
      // If we try to set item 1's parent to 3, that creates a cycle: 1 -> 3 -> 2 -> 1
      const errors = validateFormFields(
        { title: 'Test', parentId: '#3 - Item 3', dependsOn: '' },
        items,
        '1',
        ['title'],
      );
      expect(errors['parentId']).toBe('Circular parent chain detected');
    });

    it('returns no error for valid parent', () => {
      const errors = validateFormFields(
        { title: 'Test', parentId: '#1 - Item 1', dependsOn: '' },
        items,
        null,
        ['title'],
      );
      expect(errors['parentId']).toBeUndefined();
    });

    it('parses raw ID when no # format', () => {
      const errors = validateFormFields(
        { title: 'Test', parentId: '99', dependsOn: '' },
        items,
        null,
        ['title'],
      );
      expect(errors['parentId']).toBe('Parent #99 does not exist');
    });
  });

  describe('dependsOn validation', () => {
    it('returns no error when dependsOn is empty', () => {
      const errors = validateFormFields(
        { title: 'Test', parentId: '', dependsOn: '' },
        items,
        null,
        ['title'],
      );
      expect(errors['dependsOn']).toBeUndefined();
    });

    it('returns error when dependency does not exist', () => {
      const errors = validateFormFields(
        { title: 'Test', parentId: '', dependsOn: '#99 - Missing' },
        items,
        null,
        ['title'],
      );
      expect(errors['dependsOn']).toBe('Dependency #99 does not exist');
    });

    it('returns error for self-reference', () => {
      const errors = validateFormFields(
        { title: 'Test', parentId: '', dependsOn: '#1 - Item 1' },
        items,
        '1',
        ['title'],
      );
      expect(errors['dependsOn']).toBe('Cannot depend on itself');
    });

    it('returns error for circular dependency', () => {
      // Item 4 depends on item 1. If we set item 1 to depend on 4, cycle: 1 -> 4 -> 1
      const errors = validateFormFields(
        { title: 'Test', parentId: '', dependsOn: '#4 - Item 4' },
        items,
        '1',
        ['title'],
      );
      expect(errors['dependsOn']).toBe('Circular dependency detected');
    });

    it('returns no error for valid dependency', () => {
      const errors = validateFormFields(
        { title: 'Test', parentId: '', dependsOn: '#1 - Item 1' },
        items,
        null,
        ['title'],
      );
      expect(errors['dependsOn']).toBeUndefined();
    });

    it('returns error for first invalid in multiple dependencies', () => {
      const errors = validateFormFields(
        {
          title: 'Test',
          parentId: '',
          dependsOn: '#1 - Item 1, #99 - Missing',
        },
        items,
        null,
        ['title'],
      );
      expect(errors['dependsOn']).toBe('Dependency #99 does not exist');
    });

    it('returns no error when all multiple dependencies are valid', () => {
      const errors = validateFormFields(
        {
          title: 'Test',
          parentId: '',
          dependsOn: '#1 - Item 1, #2 - Item 2',
        },
        items,
        null,
        ['title'],
      );
      expect(errors['dependsOn']).toBeUndefined();
    });
  });

  describe('multiple errors', () => {
    it('returns errors for multiple fields at once', () => {
      const errors = validateFormFields(
        { title: '', parentId: '#99 - Missing', dependsOn: '#88 - Missing' },
        items,
        null,
        ['title'],
      );
      expect(errors['title']).toBe('Title is required');
      expect(errors['parentId']).toBe('Parent #99 does not exist');
      expect(errors['dependsOn']).toBe('Dependency #88 does not exist');
    });
  });
});
