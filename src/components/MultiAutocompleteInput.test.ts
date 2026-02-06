import { describe, it, expect } from 'vitest';
import { filterSuggestions } from './MultiAutocompleteInput.js';

describe('MultiAutocompleteInput', () => {
  describe('filterSuggestions', () => {
    const suggestions = ['bug', 'feature', 'enhancement', 'documentation'];

    it('filters suggestions based on current segment', () => {
      expect(filterSuggestions('feat', suggestions).visible).toEqual([
        'feature',
      ]);
    });

    it('returns all suggestions when current segment is empty', () => {
      expect(filterSuggestions('', suggestions).visible).toEqual(suggestions);
    });

    it('filters based on the segment after the last comma', () => {
      expect(filterSuggestions('bug, feat', suggestions).visible).toEqual([
        'feature',
      ]);
    });

    it('excludes already-selected labels from suggestions', () => {
      expect(filterSuggestions('bug, ', suggestions).visible).toEqual([
        'feature',
        'enhancement',
        'documentation',
      ]);
    });

    it('excludes multiple already-selected labels', () => {
      expect(filterSuggestions('bug, feature, ', suggestions).visible).toEqual([
        'enhancement',
        'documentation',
      ]);
    });

    it('is case-insensitive for filtering', () => {
      expect(filterSuggestions('BUG, Feat', suggestions).visible).toEqual([
        'feature',
      ]);
    });

    it('is case-insensitive for excluding selected labels', () => {
      expect(filterSuggestions('BUG, ', suggestions).visible).toEqual([
        'feature',
        'enhancement',
        'documentation',
      ]);
    });

    it('limits to MAX_VISIBLE suggestions', () => {
      const manySuggestions = Array.from({ length: 10 }, (_, i) => `label${i}`);
      const result = filterSuggestions('', manySuggestions);
      expect(result.visible).toHaveLength(5);
      expect(result.totalCount).toBe(10);
    });
  });
});
