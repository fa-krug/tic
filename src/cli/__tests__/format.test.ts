import { describe, it, expect } from 'vitest';
import { formatTsvRow, formatTsvKeyValue, formatJson } from '../format.js';

describe('formatTsvRow', () => {
  it('joins fields with tabs', () => {
    expect(formatTsvRow(['a', 'b', 'c'])).toBe('a\tb\tc');
  });

  it('handles empty strings', () => {
    expect(formatTsvRow(['a', '', 'c'])).toBe('a\t\tc');
  });
});

describe('formatTsvKeyValue', () => {
  it('formats key-value pairs one per line', () => {
    const pairs: [string, string][] = [
      ['id', '1'],
      ['title', 'Bug'],
    ];
    expect(formatTsvKeyValue(pairs)).toBe('id\t1\ntitle\tBug');
  });
});

describe('formatJson', () => {
  it('serializes data as indented JSON', () => {
    const data = { id: 1, title: 'Bug' };
    expect(formatJson(data)).toBe(JSON.stringify(data, null, 2));
  });
});
