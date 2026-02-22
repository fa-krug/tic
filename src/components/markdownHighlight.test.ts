import { describe, it, expect } from 'vitest';
import { tokenize, splitTokensAtCol } from './markdownHighlight.js';

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

  it('highlights ordered list markers', () => {
    const tokens = tokenize('1. first item');
    expect(tokens[0]).toEqual({ type: 'list-marker', text: '1. ' });
    expect(tokens[1]).toEqual({ type: 'text', text: 'first item' });
  });

  it('highlights indented ordered list markers', () => {
    const tokens = tokenize('  12. nested item');
    expect(tokens[0]).toEqual({ type: 'list-marker', text: '  12. ' });
    expect(tokens[1]).toEqual({ type: 'text', text: 'nested item' });
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

describe('splitTokensAtCol', () => {
  it('splits plain text at cursor position', () => {
    const tokens = tokenize('hello world');
    const result = splitTokensAtCol(tokens, 5);
    expect(result.before).toEqual([{ type: 'text', text: 'hello' }]);
    expect(result.cursor).toEqual({ type: 'text', char: ' ' });
    expect(result.after).toEqual([{ type: 'text', text: 'world' }]);
  });

  it('splits within a bold token preserving type', () => {
    const tokens = tokenize('say **bold** end');
    // "say " = 4 chars, "**bold**" starts at 4
    // cursor at col 6 is inside **bold** (the 'o' in bold)
    const result = splitTokensAtCol(tokens, 6);
    expect(result.before).toEqual([
      { type: 'text', text: 'say ' },
      { type: 'bold', text: '**' },
    ]);
    expect(result.cursor).toEqual({ type: 'bold', char: 'b' });
    expect(result.after).toEqual([
      { type: 'bold', text: 'old**' },
      { type: 'text', text: ' end' },
    ]);
  });

  it('cursor at end of line returns space cursor', () => {
    const tokens = tokenize('abc');
    const result = splitTokensAtCol(tokens, 3);
    expect(result.before).toEqual([{ type: 'text', text: 'abc' }]);
    expect(result.cursor).toEqual({ type: 'text', char: ' ' });
    expect(result.after).toEqual([]);
  });

  it('cursor at start of line', () => {
    const tokens = tokenize('hello');
    const result = splitTokensAtCol(tokens, 0);
    expect(result.before).toEqual([]);
    expect(result.cursor).toEqual({ type: 'text', char: 'h' });
    expect(result.after).toEqual([{ type: 'text', text: 'ello' }]);
  });

  it('cursor at token boundary', () => {
    const tokens = tokenize('say **bold**');
    // cursor at col 4 = start of the bold token
    const result = splitTokensAtCol(tokens, 4);
    expect(result.before).toEqual([{ type: 'text', text: 'say ' }]);
    expect(result.cursor).toEqual({ type: 'bold', char: '*' });
    expect(result.after).toEqual([{ type: 'bold', text: '*bold**' }]);
  });
});
