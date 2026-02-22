import { describe, it, expect } from 'vitest';
import { tokenize } from './markdownHighlight.js';

describe('tokenize', () => {
  it('returns plain text for no markdown', () => {
    const tokens = tokenize('hello world');
    expect(tokens).toEqual([{ type: 'text', text: 'hello world' }]);
  });

  it('highlights headings', () => {
    const tokens = tokenize('## Hello');
    expect(tokens[0]).toEqual({ type: 'heading-marker', text: '## ' });
    expect(tokens[1]).toEqual({ type: 'heading-text', text: 'Hello' });
  });

  it('highlights bold', () => {
    const tokens = tokenize('hello **bold** world');
    expect(tokens).toEqual([
      { type: 'text', text: 'hello ' },
      { type: 'bold', text: '**bold**' },
      { type: 'text', text: ' world' },
    ]);
  });

  it('highlights italic', () => {
    const tokens = tokenize('hello *italic* world');
    expect(tokens).toEqual([
      { type: 'text', text: 'hello ' },
      { type: 'italic', text: '*italic*' },
      { type: 'text', text: ' world' },
    ]);
  });

  it('highlights code spans', () => {
    const tokens = tokenize('use `foo()` here');
    expect(tokens).toEqual([
      { type: 'text', text: 'use ' },
      { type: 'code', text: '`foo()`' },
      { type: 'text', text: ' here' },
    ]);
  });

  it('code spans suppress inner markdown', () => {
    const tokens = tokenize('`**not bold**`');
    expect(tokens).toEqual([{ type: 'code', text: '`**not bold**`' }]);
  });

  it('highlights links', () => {
    const tokens = tokenize('[click](http://x.com)');
    expect(tokens).toEqual([{ type: 'link', text: '[click](http://x.com)' }]);
  });

  it('highlights image links', () => {
    const tokens = tokenize('![alt](img.png)');
    expect(tokens).toEqual([{ type: 'image', text: '![alt](img.png)' }]);
  });

  it('highlights blockquotes', () => {
    const tokens = tokenize('> quoted text');
    expect(tokens[0]).toEqual({ type: 'blockquote-marker', text: '> ' });
    expect(tokens[1]).toEqual({ type: 'blockquote-text', text: 'quoted text' });
  });

  it('highlights list bullets', () => {
    const tokens = tokenize('- list item');
    expect(tokens[0]).toEqual({ type: 'list-marker', text: '- ' });
    expect(tokens[1]).toEqual({ type: 'text', text: 'list item' });
  });

  it('highlights horizontal rules', () => {
    const tokens = tokenize('---');
    expect(tokens).toEqual([{ type: 'hr', text: '---' }]);
  });

  it('handles multiple tokens in one line', () => {
    const tokens = tokenize('hello **bold** and `code`');
    expect(tokens.length).toBe(4);
    expect(tokens[1]!.type).toBe('bold');
    expect(tokens[3]!.type).toBe('code');
  });
});
