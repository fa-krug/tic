import React from 'react';
import { Text } from 'ink';

export type TokenType =
  | 'text'
  | 'heading-marker'
  | 'heading-text'
  | 'bold'
  | 'italic'
  | 'code'
  | 'code-fence'
  | 'code-block'
  | 'link'
  | 'image'
  | 'blockquote-marker'
  | 'blockquote-text'
  | 'list-marker'
  | 'hr';

export type LineContext =
  | 'normal'
  | 'code-fence'
  | 'code-block'
  | 'setext-heading'
  | 'setext-underline';

const CODE_FENCE_RE = /^\s*```/;
const SETEXT_UNDERLINE_RE = /^(?:={2,}|-{2,})\s*$/;

export function computeLineContexts(lines: string[]): LineContext[] {
  const contexts: LineContext[] = [];
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const isFence = CODE_FENCE_RE.test(line);
    if (isFence && !inCodeBlock) {
      contexts.push('code-fence');
      inCodeBlock = true;
    } else if (isFence && inCodeBlock) {
      contexts.push('code-fence');
      inCodeBlock = false;
    } else if (inCodeBlock) {
      contexts.push('code-block');
    } else {
      // Check for setext underline: non-empty previous line + current is === or ---
      const prevLine = i > 0 ? lines[i - 1]! : '';
      if (
        SETEXT_UNDERLINE_RE.test(line) &&
        prevLine.trim().length > 0 &&
        contexts[i - 1] === 'normal'
      ) {
        contexts[i - 1] = 'setext-heading';
        contexts.push('setext-underline');
      } else {
        contexts.push('normal');
      }
    }
  }

  return contexts;
}

export interface Token {
  type: TokenType;
  text: string;
}

interface InlinePattern {
  type: TokenType;
  regex: RegExp;
}

const inlinePatterns: InlinePattern[] = [
  { type: 'code', regex: /`[^`]+`/ },
  { type: 'bold', regex: /\*\*(.+?)\*\*/ },
  { type: 'italic', regex: /(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/ },
  { type: 'image', regex: /!\[.*?\]\(.*?\)/ },
  { type: 'link', regex: /\[.*?\]\(.*?\)/ },
];

function tokenizeInline(text: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;

  while (pos < text.length) {
    let earliest: { index: number; match: string; type: TokenType } | null =
      null;

    for (const pattern of inlinePatterns) {
      const remaining = text.slice(pos);
      const m = pattern.regex.exec(remaining);
      if (m && (earliest === null || m.index < earliest.index)) {
        earliest = {
          index: m.index,
          match: m[0],
          type: pattern.type,
        };
      }
    }

    if (!earliest) {
      tokens.push({ type: 'text', text: text.slice(pos) });
      break;
    }

    if (earliest.index > 0) {
      tokens.push({
        type: 'text',
        text: text.slice(pos, pos + earliest.index),
      });
    }

    tokens.push({ type: earliest.type, text: earliest.match });
    pos += earliest.index + earliest.match.length;
  }

  return tokens;
}

export function tokenize(
  line: string,
  context: LineContext = 'normal',
): Token[] {
  // Code block contexts — no inline parsing
  if (context === 'code-fence') {
    return [{ type: 'code-fence', text: line }];
  }
  if (context === 'code-block') {
    return [{ type: 'code-block', text: line }];
  }

  // Setext heading contexts
  if (context === 'setext-heading') {
    return [{ type: 'heading-text', text: line }];
  }
  if (context === 'setext-underline') {
    return [{ type: 'heading-marker', text: line }];
  }

  // Horizontal rule (must check before list bullet since --- starts with -)
  if (/^---+$/.test(line)) {
    return [{ type: 'hr', text: line }];
  }

  // Heading
  const headingMatch = /^(#{1,6}\s)(.*)/.exec(line);
  if (headingMatch) {
    return [
      { type: 'heading-marker', text: headingMatch[1]! },
      { type: 'heading-text', text: headingMatch[2]! },
    ];
  }

  // Blockquote
  const blockquoteMatch = /^(>\s)(.*)/.exec(line);
  if (blockquoteMatch) {
    return [
      { type: 'blockquote-marker', text: blockquoteMatch[1]! },
      { type: 'blockquote-text', text: blockquoteMatch[2]! },
    ];
  }

  // List bullet or ordered list (process remainder for inline tokens)
  const listMatch = /^(\s*(?:[-*+]|\d+\.)\s)(.*)/.exec(line);
  if (listMatch) {
    const marker: Token = { type: 'list-marker', text: listMatch[1]! };
    const rest = tokenizeInline(listMatch[2]!);
    return [marker, ...rest];
  }

  // Plain inline content
  return tokenizeInline(line);
}

const tokenStyles: Record<
  TokenType,
  { bold?: boolean; dimColor?: boolean; color?: string; underline?: boolean }
> = {
  'heading-marker': { bold: true, dimColor: true },
  'heading-text': { bold: true, color: 'cyan' },
  bold: { bold: true, color: 'white' },
  italic: { dimColor: true },
  code: { color: 'yellow' },
  'code-fence': { dimColor: true },
  'code-block': { color: 'yellow' },
  link: { color: 'blue', underline: true },
  image: { color: 'green' },
  'blockquote-marker': { dimColor: true },
  'blockquote-text': { dimColor: true },
  'list-marker': { color: 'cyan' },
  hr: { dimColor: true },
  text: {},
};

export interface CursorSplit {
  before: Token[];
  cursor: { type: TokenType; char: string };
  after: Token[];
}

export function splitTokensAtCol(tokens: Token[], col: number): CursorSplit {
  let pos = 0;
  const totalLen = tokens.reduce((sum, t) => sum + t.text.length, 0);

  // Cursor past end of line
  if (col >= totalLen) {
    return {
      before: tokens,
      cursor: { type: 'text', char: ' ' },
      after: [],
    };
  }

  const before: Token[] = [];
  const after: Token[] = [];

  let cursorResult: { type: TokenType; char: string } | null = null;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    const tokenStart = pos;
    const tokenEnd = pos + token.text.length;

    if (cursorResult) {
      // Already found cursor, remaining tokens go to after
      after.push(token);
    } else if (col < tokenEnd) {
      // Cursor is within this token
      const offsetInToken = col - tokenStart;
      if (offsetInToken > 0) {
        before.push({
          type: token.type,
          text: token.text.slice(0, offsetInToken),
        });
      }
      cursorResult = { type: token.type, char: token.text[offsetInToken]! };
      if (offsetInToken + 1 < token.text.length) {
        after.push({
          type: token.type,
          text: token.text.slice(offsetInToken + 1),
        });
      }
    } else {
      // Entire token is before cursor
      before.push(token);
    }

    pos = tokenEnd;
  }

  return {
    before,
    cursor: cursorResult ?? { type: 'text', char: ' ' },
    after,
  };
}

export function sliceTokens(
  tokens: Token[],
  start: number,
  end: number,
): Token[] {
  const result: Token[] = [];
  let pos = 0;

  for (const token of tokens) {
    const tStart = pos;
    const tEnd = pos + token.text.length;
    if (tEnd > start && tStart < end) {
      const sliceStart = Math.max(0, start - tStart);
      const sliceEnd = Math.min(token.text.length, end - tStart);
      result.push({
        type: token.type,
        text: token.text.slice(sliceStart, sliceEnd),
      });
    }
    pos = tEnd;
    if (pos >= end) break;
  }

  return result;
}

export function highlightLine(
  line: string,
  context: LineContext = 'normal',
): React.ReactNode {
  const tokens = tokenize(line, context);
  // Empty lines must render a space so the Box maintains 1 row of height
  if (tokens.length === 0) {
    return React.createElement(Text, null, ' ');
  }
  if (tokens.length === 1 && tokens[0]!.type === 'text') {
    return React.createElement(Text, null, tokens[0]!.text);
  }

  return React.createElement(
    React.Fragment,
    null,
    ...tokens.map((token, i) => {
      const style = tokenStyles[token.type];
      return React.createElement(Text, { key: i, ...style }, token.text);
    }),
  );
}

function renderTokens(tokens: Token[], keyOffset: number): React.ReactNode[] {
  return tokens.map((token, i) => {
    const style = tokenStyles[token.type];
    return React.createElement(
      Text,
      { key: keyOffset + i, ...style },
      token.text,
    );
  });
}

export function highlightLineWithCursor(
  line: string,
  cursorCol: number,
  context: LineContext = 'normal',
): React.ReactNode {
  const tokens = tokenize(line, context);
  const { before, cursor, after } = splitTokensAtCol(tokens, cursorCol);
  const cursorStyle = tokenStyles[cursor.type];

  return React.createElement(
    React.Fragment,
    null,
    ...renderTokens(before, 0),
    React.createElement(
      Text,
      { key: 'cursor', ...cursorStyle, inverse: true },
      cursor.char,
    ),
    ...renderTokens(after, before.length + 1),
  );
}

export function highlightSlice(
  fullLine: string,
  sliceStart: number,
  sliceEnd: number,
  context: LineContext = 'normal',
): React.ReactNode {
  const tokens = tokenize(fullLine, context);
  const sliced = sliceTokens(tokens, sliceStart, sliceEnd);
  if (sliced.length === 0) {
    return React.createElement(Text, null, ' ');
  }
  if (sliced.length === 1 && sliced[0]!.type === 'text') {
    return React.createElement(Text, null, sliced[0]!.text);
  }
  return React.createElement(
    React.Fragment,
    null,
    ...sliced.map((token, i) => {
      const style = tokenStyles[token.type];
      return React.createElement(Text, { key: i, ...style }, token.text);
    }),
  );
}

export function highlightSliceWithCursor(
  fullLine: string,
  sliceStart: number,
  sliceEnd: number,
  cursorCol: number,
  context: LineContext = 'normal',
): React.ReactNode {
  const tokens = tokenize(fullLine, context);
  const sliced = sliceTokens(tokens, sliceStart, sliceEnd);
  // Adjust cursor col relative to the slice
  const adjustedCol = cursorCol - sliceStart;
  const { before, cursor, after } = splitTokensAtCol(sliced, adjustedCol);
  const cursorStyle = tokenStyles[cursor.type];

  return React.createElement(
    React.Fragment,
    null,
    ...renderTokens(before, 0),
    React.createElement(
      Text,
      { key: 'cursor', ...cursorStyle, inverse: true },
      cursor.char,
    ),
    ...renderTokens(after, before.length + 1),
  );
}
