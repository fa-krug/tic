import { describe, it, expect } from 'vitest';
import { filterSuggestions } from './AutocompleteInput.js';

describe('filterSuggestions', () => {
  it('filters suggestions by case-insensitive substring match', () => {
    const result = filterSuggestions('AL', ['alice', 'bob', 'ALBERT']);
    expect(result).toEqual(['alice', 'ALBERT']);
  });

  it('returns all suggestions (up to cap) when input is empty', () => {
    const result = filterSuggestions('', ['alice', 'bob', 'charlie']);
    expect(result).toEqual(['alice', 'bob', 'charlie']);
  });

  it('caps visible suggestions at 5', () => {
    const suggestions = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const result = filterSuggestions('', suggestions);
    expect(result).toHaveLength(5);
    expect(result).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('returns empty array when nothing matches', () => {
    const result = filterSuggestions('zzz', ['alice', 'bob']);
    expect(result).toEqual([]);
  });

  it('matches anywhere in the string', () => {
    const result = filterSuggestions('ice', ['alice', 'bob']);
    expect(result).toEqual(['alice']);
  });

  it('handles empty suggestions list', () => {
    const result = filterSuggestions('test', []);
    expect(result).toEqual([]);
  });
});
