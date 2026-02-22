import React from 'react';
import { Text } from 'ink';

export type TokenType =
  | 'text'
  | 'heading-marker'
  | 'heading-text'
  | 'bold'
  | 'italic'
  | 'code'
  | 'link'
  | 'image'
  | 'blockquote-marker'
  | 'blockquote-text'
  | 'list-marker'
  | 'hr';

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

export function tokenize(line: string): Token[] {
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
  bold: { bold: true },
  italic: { dimColor: true },
  code: { color: 'yellow' },
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

export function highlightLine(line: string): React.ReactNode {
  const tokens = tokenize(line);
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
): React.ReactNode {
  const tokens = tokenize(line);
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
