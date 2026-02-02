import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BackendCache } from './cache.js';
import type { WorkItem } from '../types.js';

const makeItem = (id: string, iteration = ''): WorkItem => ({
  id,
  title: `Item ${id}`,
  type: 'task',
  status: 'open',
  priority: 'medium',
  assignee: '',
  labels: [],
  parent: null,
  dependsOn: [],
  iteration,
  description: '',
  comments: [],
  created: '2026-01-01T00:00:00Z',
  updated: '2026-01-01T00:00:00Z',
});

describe('BackendCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null on empty cache', () => {
    const cache = new BackendCache(0);
    expect(cache.get()).toBeNull();
  });

  it('returns cached items after set', () => {
    const cache = new BackendCache(0);
    const items = [makeItem('1'), makeItem('2')];
    cache.set(items);
    expect(cache.get()).toEqual(items);
  });

  it('caches by iteration key', () => {
    const cache = new BackendCache(0);
    const all = [makeItem('1', 'sprint-1'), makeItem('2', 'sprint-2')];
    const sprint1 = [makeItem('1', 'sprint-1')];
    cache.set(all);
    cache.set(sprint1, 'sprint-1');
    expect(cache.get()).toEqual(all);
    expect(cache.get('sprint-1')).toEqual(sprint1);
  });

  it('invalidate clears all cached data', () => {
    const cache = new BackendCache(0);
    cache.set([makeItem('1')]);
    cache.set([makeItem('1')], 'sprint-1');
    cache.invalidate();
    expect(cache.get()).toBeNull();
    expect(cache.get('sprint-1')).toBeNull();
  });

  it('ttl=0 means cache never expires', () => {
    const cache = new BackendCache(0);
    cache.set([makeItem('1')]);
    vi.advanceTimersByTime(999999);
    expect(cache.get()).not.toBeNull();
  });

  it('ttl > 0 expires after duration', () => {
    const cache = new BackendCache(60000);
    cache.set([makeItem('1')]);
    expect(cache.get()).not.toBeNull();
    vi.advanceTimersByTime(60001);
    expect(cache.get()).toBeNull();
  });

  it('iteration-keyed cache also expires with ttl', () => {
    const cache = new BackendCache(60000);
    cache.set([makeItem('1', 's1')], 's1');
    vi.advanceTimersByTime(60001);
    expect(cache.get('s1')).toBeNull();
  });
});
