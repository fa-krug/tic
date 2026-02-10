// src/stores/filterStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { filterStore } from './filterStore.js';

beforeEach(() => {
  filterStore.getState().clearFilters();
});

describe('filterStore', () => {
  it('starts with empty filters', () => {
    const state = filterStore.getState();
    expect(state.activeFilters).toEqual({});
    expect(state.activeViewName).toBeNull();
  });

  it('setFilters replaces all filters', () => {
    filterStore.getState().setFilters({ statuses: ['open'], types: ['bug'] });
    expect(filterStore.getState().activeFilters).toEqual({
      statuses: ['open'],
      types: ['bug'],
    });
  });

  it('setFilters clears activeViewName', () => {
    filterStore.setState({ activeViewName: 'old view' });
    filterStore.getState().setFilters({ statuses: ['open'] });
    expect(filterStore.getState().activeViewName).toBeNull();
  });

  it('clearFilters resets to empty', () => {
    filterStore.getState().setFilters({ statuses: ['open'] });
    filterStore.getState().clearFilters();
    expect(filterStore.getState().activeFilters).toEqual({});
    expect(filterStore.getState().activeViewName).toBeNull();
  });

  it('toggleFilter adds a value to empty field', () => {
    filterStore.getState().toggleFilter('statuses', 'open');
    expect(filterStore.getState().activeFilters.statuses).toEqual(['open']);
  });

  it('toggleFilter adds a second value', () => {
    filterStore.getState().toggleFilter('statuses', 'open');
    filterStore.getState().toggleFilter('statuses', 'done');
    expect(filterStore.getState().activeFilters.statuses).toEqual([
      'open',
      'done',
    ]);
  });

  it('toggleFilter removes an existing value', () => {
    filterStore.getState().toggleFilter('statuses', 'open');
    filterStore.getState().toggleFilter('statuses', 'done');
    filterStore.getState().toggleFilter('statuses', 'open');
    expect(filterStore.getState().activeFilters.statuses).toEqual(['done']);
  });

  it('toggleFilter removes field when last value toggled off', () => {
    filterStore.getState().toggleFilter('statuses', 'open');
    filterStore.getState().toggleFilter('statuses', 'open');
    expect(filterStore.getState().activeFilters.statuses).toBeUndefined();
  });

  it('toggleFilter clears activeViewName', () => {
    filterStore.setState({ activeViewName: 'a view' });
    filterStore.getState().toggleFilter('statuses', 'open');
    expect(filterStore.getState().activeViewName).toBeNull();
  });

  it('loadView sets filters and activeViewName', () => {
    filterStore.getState().loadView({
      name: 'My bugs',
      filters: { statuses: ['open'], types: ['bug'] },
    });
    expect(filterStore.getState().activeFilters).toEqual({
      statuses: ['open'],
      types: ['bug'],
    });
    expect(filterStore.getState().activeViewName).toBe('My bugs');
  });
});
