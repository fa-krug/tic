import { describe, it, expect } from 'vitest';
import { parseFrontmatter, stringifyFrontmatter } from './frontmatter.js';

describe('parseFrontmatter', () => {
  it('parses basic frontmatter', () => {
    const raw = '---\ntitle: Hello\nstatus: open\n---\nBody text here';
    const result = parseFrontmatter(raw);
    expect(result.data).toEqual({ title: 'Hello', status: 'open' });
    expect(result.content).toBe('Body text here');
  });

  it('returns raw content when no frontmatter', () => {
    const raw = 'Just plain content';
    const result = parseFrontmatter(raw);
    expect(result.data).toEqual({});
    expect(result.content).toBe('Just plain content');
  });

  it('handles empty body', () => {
    const raw = '---\ntitle: Hello\n---\n';
    const result = parseFrontmatter(raw);
    expect(result.data).toEqual({ title: 'Hello' });
    expect(result.content).toBe('');
  });

  it('handles arrays in frontmatter', () => {
    const raw = '---\nlabels:\n  - bug\n  - urgent\n---\nDescription';
    const result = parseFrontmatter(raw);
    expect(result.data['labels']).toEqual(['bug', 'urgent']);
    expect(result.content).toBe('Description');
  });

  it('handles --- in body content after comments heading', () => {
    const raw =
      '---\ntitle: Test\n---\nDescription\n\n## Comments\n\n---\nauthor: alice\ndate: 2025-01-01\n\nA comment';
    const result = parseFrontmatter(raw);
    expect(result.data).toEqual({ title: 'Test' });
    expect(result.content).toContain('## Comments');
    expect(result.content).toContain('author: alice');
  });
});

describe('stringifyFrontmatter', () => {
  it('produces valid frontmatter output', () => {
    const result = stringifyFrontmatter('Body text', {
      title: 'Hello',
      status: 'open',
    });
    expect(result).toMatch(/^---\n/);
    expect(result).toContain('title: Hello');
    expect(result).toContain('status: open');
    expect(result).toMatch(/\n---\nBody text\n$/);
  });

  it('handles empty body', () => {
    const result = stringifyFrontmatter('', { title: 'Hello' });
    expect(result).toMatch(/\n---\n\n$/);
  });
});

describe('round-trip', () => {
  it('parse then stringify preserves data', () => {
    const data = {
      id: '42',
      title: 'Test item',
      type: 'bug',
      status: 'open',
      labels: ['a', 'b'],
    };
    const body = 'Some description';
    const serialized = stringifyFrontmatter(body, data);
    const parsed = parseFrontmatter(serialized);
    expect(parsed.data).toEqual(data);
    expect(parsed.content).toBe(body + '\n');
  });
});
