import { describe, it, expect } from 'vitest';
import { truncateDescription } from './DetailPanel.js';

describe('truncateDescription', () => {
  it('returns first line truncated to width', () => {
    const desc = 'This is a long description that should be truncated';
    expect(truncateDescription(desc, 20)).toBe('This is a long desc\u2026');
  });

  it('returns full first line when shorter than width', () => {
    expect(truncateDescription('Short', 80)).toBe('Short');
  });

  it('returns empty string for empty description', () => {
    expect(truncateDescription('', 80)).toBe('');
  });

  it('uses only the first line of multi-line text', () => {
    const desc = 'First line\nSecond line\nThird line';
    expect(truncateDescription(desc, 80)).toBe('First line');
  });

  it('truncates first line of multi-line text when too long', () => {
    const desc = 'This is a very long first line\nSecond line';
    expect(truncateDescription(desc, 20)).toBe('This is a very long\u2026');
  });
});
