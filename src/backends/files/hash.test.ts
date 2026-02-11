import { describe, it, expect } from 'vitest';
import { contentHash } from './hash.js';

describe('contentHash', () => {
  it('produces deterministic hash', () => {
    expect(contentHash('hello')).toBe(contentHash('hello'));
  });

  it('produces different hashes for different content', () => {
    expect(contentHash('a')).not.toBe(contentHash('b'));
  });

  it('returns a hex string', () => {
    expect(contentHash('test')).toMatch(/^[0-9a-f]+$/);
  });
});
