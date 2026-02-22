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

  // List bullet (don't return — process remainder for inline tokens)
  const listMatch = /^(\s*[-*+]\s)(.*)/.exec(line);
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
