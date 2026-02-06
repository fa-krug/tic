import { describe, it, expect } from 'vitest';
import { filterSuggestions } from './AutocompleteInput.js';

describe('filterSuggestions', () => {
  it('filters suggestions by case-insensitive substring match', () => {
    const result = filterSuggestions('AL', ['alice', 'bob', 'ALBERT']);
    expect(result.visible).toEqual(['alice', 'ALBERT']);
  });

  it('returns all suggestions (up to cap) when input is empty', () => {
    const result = filterSuggestions('', ['alice', 'bob', 'charlie']);
    expect(result.visible).toEqual(['alice', 'bob', 'charlie']);
  });

  it('caps visible suggestions at 5', () => {
    const suggestions = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const result = filterSuggestions('', suggestions);
    expect(result.visible).toHaveLength(5);
    expect(result.visible).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('returns empty array when nothing matches', () => {
    const result = filterSuggestions('zzz', ['alice', 'bob']);
    expect(result.visible).toEqual([]);
  });

  it('matches anywhere in the string', () => {
    const result = filterSuggestions('ice', ['alice', 'bob']);
    expect(result.visible).toEqual(['alice']);
  });

  it('handles empty suggestions list', () => {
    const result = filterSuggestions('test', []);
    expect(result.visible).toEqual([]);
  });

  it('returns totalCount alongside visible suggestions', () => {
    const suggestions = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const result = filterSuggestions('', suggestions);
    expect(result.visible).toHaveLength(5);
    expect(result.totalCount).toBe(7);
  });

  it('totalCount equals visible length when under cap', () => {
    const result = filterSuggestions('', ['alice', 'bob']);
    expect(result.visible).toEqual(['alice', 'bob']);
    expect(result.totalCount).toBe(2);
  });
});
