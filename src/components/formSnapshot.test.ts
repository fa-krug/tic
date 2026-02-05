import { describe, it, expect } from 'vitest';
import { createSnapshot, isSnapshotEqual } from './formSnapshot.js';

describe('createSnapshot', () => {
  it('creates a snapshot from form values', () => {
    const snap = createSnapshot({
      title: 'Bug fix',
      type: 'issue',
      status: 'open',
      iteration: 'sprint-1',
      priority: 'medium',
      assignee: 'alice',
      labels: 'bug, ui',
      description: 'Fix the thing',
      parentId: '#1 - Parent',
      dependsOn: '#2 - Dep',
      newComment: '',
    });
    expect(snap.title).toBe('Bug fix');
    expect(snap.assignee).toBe('alice');
  });
});

describe('isSnapshotEqual', () => {
  const base = createSnapshot({
    title: 'Bug fix',
    type: 'issue',
    status: 'open',
    iteration: '',
    priority: 'medium',
    assignee: '',
    labels: '',
    description: '',
    parentId: '',
    dependsOn: '',
    newComment: '',
  });

  it('returns true for identical snapshots', () => {
    const current = createSnapshot({
      title: 'Bug fix',
      type: 'issue',
      status: 'open',
      iteration: '',
      priority: 'medium',
      assignee: '',
      labels: '',
      description: '',
      parentId: '',
      dependsOn: '',
      newComment: '',
    });
    expect(isSnapshotEqual(base, current)).toBe(true);
  });

  it('returns false when title differs', () => {
    const current = createSnapshot({
      title: 'Changed',
      type: 'issue',
      status: 'open',
      iteration: '',
      priority: 'medium',
      assignee: '',
      labels: '',
      description: '',
      parentId: '',
      dependsOn: '',
      newComment: '',
    });
    expect(isSnapshotEqual(base, current)).toBe(false);
  });

  it('returns false when description differs', () => {
    const current = createSnapshot({
      title: 'Bug fix',
      type: 'issue',
      status: 'open',
      iteration: '',
      priority: 'medium',
      assignee: '',
      labels: '',
      description: 'new desc',
      parentId: '',
      dependsOn: '',
      newComment: '',
    });
    expect(isSnapshotEqual(base, current)).toBe(false);
  });

  it('returns false when newComment is non-empty', () => {
    const current = createSnapshot({
      title: 'Bug fix',
      type: 'issue',
      status: 'open',
      iteration: '',
      priority: 'medium',
      assignee: '',
      labels: '',
      description: '',
      parentId: '',
      dependsOn: '',
      newComment: 'a comment',
    });
    expect(isSnapshotEqual(base, current)).toBe(false);
  });
});
