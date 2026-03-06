import { describe, it, expect } from 'vitest';
import {
  tokenize,
  splitTokensAtCol,
  sliceTokens,
  computeLineContexts,
} from './markdownHighlight.js';

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

  it('highlights setext heading text', () => {
    const tokens = tokenize('Overview', 'setext-heading');
    expect(tokens).toEqual([{ type: 'heading-text', text: 'Overview' }]);
  });

  it('highlights setext underline as heading marker', () => {
    const tokens = tokenize('--------', 'setext-underline');
    expect(tokens).toEqual([{ type: 'heading-marker', text: '--------' }]);
  });

  it('handles multiple tokens in one line', () => {
    const tokens = tokenize('hello **bold** and `code`');
    expect(tokens.length).toBe(4);
    expect(tokens[1]!.type).toBe('bold');
    expect(tokens[3]!.type).toBe('code');
  });

  it('highlights code fence line', () => {
    const tokens = tokenize('```js', 'code-fence');
    expect(tokens).toEqual([{ type: 'code-fence', text: '```js' }]);
  });

  it('highlights code block content as code-block', () => {
    const tokens = tokenize('const x = 1;', 'code-block');
    expect(tokens).toEqual([{ type: 'code-block', text: 'const x = 1;' }]);
  });

  it('does not parse inline markdown inside code block', () => {
    const tokens = tokenize('**not bold** and `not code`', 'code-block');
    expect(tokens).toEqual([
      { type: 'code-block', text: '**not bold** and `not code`' },
    ]);
  });
});

describe('computeLineContexts', () => {
  it('returns normal for non-code-block lines', () => {
    const contexts = computeLineContexts(['hello', 'world']);
    expect(contexts).toEqual(['normal', 'normal']);
  });

  it('marks fenced code block lines correctly', () => {
    const lines = ['before', '```', 'code here', '```', 'after'];
    const contexts = computeLineContexts(lines);
    expect(contexts).toEqual([
      'normal',
      'code-fence',
      'code-block',
      'code-fence',
      'normal',
    ]);
  });

  it('handles code fence with language specifier', () => {
    const lines = ['```typescript', 'const x = 1;', '```'];
    const contexts = computeLineContexts(lines);
    expect(contexts).toEqual(['code-fence', 'code-block', 'code-fence']);
  });

  it('handles unclosed code block (extends to end)', () => {
    const lines = ['text', '```', 'code', 'more code'];
    const contexts = computeLineContexts(lines);
    expect(contexts).toEqual([
      'normal',
      'code-fence',
      'code-block',
      'code-block',
    ]);
  });

  it('handles multiple code blocks', () => {
    const lines = ['```', 'a', '```', 'between', '```', 'b', '```'];
    const contexts = computeLineContexts(lines);
    expect(contexts).toEqual([
      'code-fence',
      'code-block',
      'code-fence',
      'normal',
      'code-fence',
      'code-block',
      'code-fence',
    ]);
  });

  it('handles indented code fences', () => {
    const lines = ['  ```', '  code', '  ```'];
    const contexts = computeLineContexts(lines);
    expect(contexts).toEqual(['code-fence', 'code-block', 'code-fence']);
  });

  it('handles empty code block', () => {
    const lines = ['```', '```'];
    const contexts = computeLineContexts(lines);
    expect(contexts).toEqual(['code-fence', 'code-fence']);
  });

  it('detects setext h2 headings (--- underline)', () => {
    const lines = ['Overview', '--------', 'body text'];
    const contexts = computeLineContexts(lines);
    expect(contexts).toEqual(['setext-heading', 'setext-underline', 'normal']);
  });

  it('detects setext h1 headings (=== underline)', () => {
    const lines = ['Title', '=====', 'body text'];
    const contexts = computeLineContexts(lines);
    expect(contexts).toEqual(['setext-heading', 'setext-underline', 'normal']);
  });

  it('does not treat --- as setext if previous line is empty', () => {
    const lines = ['', '---'];
    const contexts = computeLineContexts(lines);
    expect(contexts).toEqual(['normal', 'normal']);
  });

  it('does not treat --- inside code blocks as setext', () => {
    const lines = ['```', 'heading', '---', '```'];
    const contexts = computeLineContexts(lines);
    expect(contexts).toEqual([
      'code-fence',
      'code-block',
      'code-block',
      'code-fence',
    ]);
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

describe('sliceTokens', () => {
  it('returns full tokens when slice covers everything', () => {
    const tokens = tokenize('hello world');
    const sliced = sliceTokens(tokens, 0, 11);
    expect(sliced).toEqual([{ type: 'text', text: 'hello world' }]);
  });

  it('slices within a single token', () => {
    const tokens = tokenize('hello world');
    const sliced = sliceTokens(tokens, 3, 8);
    expect(sliced).toEqual([{ type: 'text', text: 'lo wo' }]);
  });

  it('slices across token boundaries', () => {
    const tokens = tokenize('say **bold** end');
    // "say " (4) + "**bold**" (8) + " end" (4) = 16
    // slice [2, 14) = "y **bold** e"
    const sliced = sliceTokens(tokens, 2, 14);
    expect(sliced).toEqual([
      { type: 'text', text: 'y ' },
      { type: 'bold', text: '**bold**' },
      { type: 'text', text: ' e' },
    ]);
  });

  it('slices within a styled token', () => {
    const tokens = tokenize('say **bold** end');
    // slice [6, 10) = "bold"
    const sliced = sliceTokens(tokens, 6, 10);
    expect(sliced).toEqual([{ type: 'bold', text: 'bold' }]);
  });

  it('returns empty array for out-of-range slice', () => {
    const tokens = tokenize('hi');
    const sliced = sliceTokens(tokens, 5, 10);
    expect(sliced).toEqual([]);
  });
});
