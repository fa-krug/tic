import { describe, it, expect } from 'vitest';
import {
  pickDefaultType,
  canSwitchTypes,
  nextType,
} from './work-item-types.js';

const AZURE_AGILE = [
  'Bug',
  'Code Review Request',
  'Epic',
  'Feature',
  'Task',
  'Test Case',
  'User Story',
];

describe('pickDefaultType', () => {
  it('returns undefined when there are no types', () => {
    expect(pickDefaultType([], 'issue')).toBeUndefined();
  });

  it('keeps the configured default when the backend has it', () => {
    expect(pickDefaultType(['epic', 'issue', 'task'], 'task')).toBe('task');
    expect(pickDefaultType(AZURE_AGILE, 'Bug')).toBe('Bug');
  });

  it('prefers the type the backend reports as its default', () => {
    expect(
      pickDefaultType(AZURE_AGILE, 'issue', { backendDefault: 'Feature' }),
    ).toBe('Feature');
  });

  it('ignores a backend default that is not one of the types', () => {
    expect(
      pickDefaultType(AZURE_AGILE, 'issue', { backendDefault: 'Story Point' }),
    ).toBe('User Story');
  });

  it('falls back to User Story for the Azure Agile process', () => {
    expect(pickDefaultType(AZURE_AGILE, 'issue')).toBe('User Story');
  });

  it('falls back to Product Backlog Item for the Azure Scrum process', () => {
    expect(
      pickDefaultType(['Bug', 'Epic', 'Feature', 'Product Backlog Item'], ''),
    ).toBe('Product Backlog Item');
  });

  it('falls back to Requirement for the Azure CMMI process', () => {
    expect(pickDefaultType(['Bug', 'Change Request', 'Requirement'])).toBe(
      'Requirement',
    );
  });

  it('falls back to Issue for the Azure Basic process', () => {
    expect(pickDefaultType(['Epic', 'Issue', 'Task'], null)).toBe('Issue');
  });

  it('matches backlog type names case-insensitively', () => {
    expect(pickDefaultType(['bug', 'story', 'task'], 'issue')).toBe('story');
  });

  it('falls back to the type with the most items', () => {
    const items = [
      { type: 'Defect' },
      { type: 'Chore' },
      { type: 'Chore' },
      { type: 'Unknown' },
      { type: 'Unknown' },
      { type: 'Unknown' },
    ];
    expect(pickDefaultType(['Defect', 'Chore'], 'issue', { items })).toBe(
      'Chore',
    );
  });

  it('breaks item-count ties by type order', () => {
    const items = [{ type: 'Chore' }, { type: 'Defect' }];
    expect(pickDefaultType(['Defect', 'Chore'], undefined, { items })).toBe(
      'Defect',
    );
  });

  it('falls back to the first type when nothing else matches', () => {
    expect(pickDefaultType(['Defect', 'Chore'], 'issue')).toBe('Defect');
    expect(pickDefaultType(['Defect', 'Chore'], 'issue', { items: [] })).toBe(
      'Defect',
    );
  });
});

describe('canSwitchTypes', () => {
  it('is false for zero or one type', () => {
    expect(canSwitchTypes([])).toBe(false);
    expect(canSwitchTypes(['issue'])).toBe(false);
  });

  it('is true for more than one type', () => {
    expect(canSwitchTypes(['Bug', 'User Story'])).toBe(true);
  });
});

describe('nextType', () => {
  it('cycles to the following type and wraps around', () => {
    expect(nextType(['Bug', 'Task', 'User Story'], 'Bug')).toBe('Task');
    expect(nextType(['Bug', 'Task', 'User Story'], 'User Story')).toBe('Bug');
  });

  it('starts at the first type when the active type is unknown', () => {
    expect(nextType(['Bug', 'Task'], null)).toBe('Bug');
    expect(nextType(['Bug', 'Task'], 'issue')).toBe('Bug');
  });

  it('returns undefined when there are no types', () => {
    expect(nextType([], 'Bug')).toBeUndefined();
  });
});
