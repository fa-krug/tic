import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import {
  DetailPanel,
  truncateDescription,
  wrapLine,
  countWrappedLines,
} from './DetailPanel.js';
import type { WorkItem } from '../types.js';

function makeItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    rowId: 42,
    id: '42',
    title: 'Fix the login bug',
    type: 'task',
    status: 'in-progress',
    iteration: 'default',
    priority: 'high',
    assignee: 'alice',
    labels: ['bug', 'frontend'],
    created: '2025-01-01',
    updated: '2025-01-02',
    description: '',
    comments: [],
    parent: null,
    dependsOn: [],
    ...overrides,
  };
}

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

describe('wrapLine', () => {
  it('returns a single segment for short lines', () => {
    expect(wrapLine('hello', 80)).toEqual([{ start: 0, end: 5 }]);
  });

  it('wraps at word boundary', () => {
    const line = 'hello world foo bar';
    const segments = wrapLine(line, 12);
    expect(segments.length).toBe(2);
    expect(line.slice(segments[0]!.start, segments[0]!.end)).toBe(
      'hello world ',
    );
    expect(line.slice(segments[1]!.start, segments[1]!.end)).toBe('foo bar');
  });

  it('hard-breaks when no space found', () => {
    const line = 'abcdefghijklmnop';
    const segments = wrapLine(line, 5);
    expect(segments.length).toBe(4);
    expect(line.slice(segments[0]!.start, segments[0]!.end)).toBe('abcde');
    expect(line.slice(segments[1]!.start, segments[1]!.end)).toBe('fghij');
    expect(line.slice(segments[2]!.start, segments[2]!.end)).toBe('klmno');
    expect(line.slice(segments[3]!.start, segments[3]!.end)).toBe('p');
  });

  it('returns single segment for empty line', () => {
    expect(wrapLine('', 80)).toEqual([{ start: 0, end: 0 }]);
  });

  it('handles line exactly at width', () => {
    expect(wrapLine('12345', 5)).toEqual([{ start: 0, end: 5 }]);
  });
});

describe('countWrappedLines', () => {
  it('counts total visual lines after wrapping', () => {
    const lines = ['short', 'this is a longer line that wraps'];
    // "short" = 1 line, "this is a longer line that wraps" at width 15:
    // "this is a " (10), "longer line " (12), "that wraps" (10) → 3 lines? Let me check...
    // Actually: lastIndexOf(' ', 0+15) in "this is a longer line that wraps" → index 9 ("a ") → breakAt=10
    // "this is a " (0-10), then from 10: "longer line that wraps" (22 chars > 15)
    // lastIndexOf(' ', 10+15=25) → index 21 ("t") wait that's a 't'. Let me count...
    // "this is a longer line that wraps"
    //  0123456789...
    // pos=10, remaining: "longer line that wraps" length=22
    // line.lastIndexOf(' ', 10+15=25) → space at index 25? "this is a longer line that wraps"
    //                                                         0         1         2         3
    //                                                         0123456789012345678901234567890
    // spaces at: 4, 7, 9, 16, 21, 26
    // lastIndexOf(' ', 25) → 21 ("line "). breakAt=22. segment: {10, 22} = "longer line "
    // pos=22, remaining: "that wraps" (9 chars) <= 15. segment: {22, 31}
    // Total: 3 lines
    expect(countWrappedLines(lines, 15)).toBe(4); // 1 + 3
  });

  it('returns line count when no wrapping needed', () => {
    expect(countWrappedLines(['a', 'b', 'c'], 80)).toBe(3);
  });
});

describe('DetailPanel', () => {
  it('renders title, id, status, assignee, priority, and labels', () => {
    const { lastFrame } = render(
      <DetailPanel item={makeItem()} terminalWidth={80} />,
    );
    const frame = lastFrame();
    expect(frame).toContain('Fix the login bug');
    expect(frame).toContain('#42');
    expect(frame).toContain('in-progress');
    expect(frame).toContain('@alice');
    expect(frame).toContain('high');
    expect(frame).toContain('bug');
    expect(frame).toContain('frontend');
  });

  it('omits assignee when empty', () => {
    const { lastFrame } = render(
      <DetailPanel item={makeItem({ assignee: '' })} terminalWidth={80} />,
    );
    const frame = lastFrame();
    expect(frame).not.toContain('@');
    expect(frame).toContain('#42');
    expect(frame).toContain('in-progress');
  });

  it('omits bottom line when no labels and no priority', () => {
    const { lastFrame } = render(
      <DetailPanel
        item={makeItem({
          priority: '' as WorkItem['priority'],
          labels: [],
        })}
        terminalWidth={80}
      />,
    );
    const frame = lastFrame();
    expect(frame).toContain('#42');
    // Should not have the priority/labels row
    expect(frame).not.toContain('▲');
    expect(frame).not.toContain('▽');
    expect(frame).not.toContain('frontend');
  });

  it('shows priority pill for critical', () => {
    const { lastFrame } = render(
      <DetailPanel
        item={makeItem({ priority: 'critical' })}
        terminalWidth={80}
      />,
    );
    expect(lastFrame()).toContain('critical');
  });

  it('shows priority pill for low', () => {
    const { lastFrame } = render(
      <DetailPanel item={makeItem({ priority: 'low' })} terminalWidth={80} />,
    );
    expect(lastFrame()).toContain('low');
  });
});
