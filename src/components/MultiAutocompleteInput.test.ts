import { describe, it, expect } from 'vitest';
import { filterSuggestions } from './MultiAutocompleteInput.js';

describe('MultiAutocompleteInput', () => {
  describe('filterSuggestions', () => {
    const suggestions = ['bug', 'feature', 'enhancement', 'documentation'];

    it('filters suggestions based on current segment', () => {
      expect(filterSuggestions('feat', suggestions)).toEqual(['feature']);
    });

    it('returns all suggestions when current segment is empty', () => {
      expect(filterSuggestions('', suggestions)).toEqual(suggestions);
    });

    it('filters based on the segment after the last comma', () => {
      expect(filterSuggestions('bug, feat', suggestions)).toEqual(['feature']);
    });

    it('excludes already-selected labels from suggestions', () => {
      expect(filterSuggestions('bug, ', suggestions)).toEqual([
        'feature',
        'enhancement',
        'documentation',
      ]);
    });

    it('excludes multiple already-selected labels', () => {
      expect(filterSuggestions('bug, feature, ', suggestions)).toEqual([
        'enhancement',
        'documentation',
      ]);
    });

    it('is case-insensitive for filtering', () => {
      expect(filterSuggestions('BUG, Feat', suggestions)).toEqual(['feature']);
    });

    it('is case-insensitive for excluding selected labels', () => {
      expect(filterSuggestions('BUG, ', suggestions)).toEqual([
        'feature',
        'enhancement',
        'documentation',
      ]);
    });

    it('limits to MAX_VISIBLE suggestions', () => {
      const manySuggestions = Array.from({ length: 10 }, (_, i) => `label${i}`);
      expect(filterSuggestions('', manySuggestions)).toHaveLength(5);
    });
  });
});
