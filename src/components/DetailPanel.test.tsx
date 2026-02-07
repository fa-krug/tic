import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { DetailPanel } from './DetailPanel.js';
import type { WorkItem } from '../types.js';

function makeItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
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
    expect(frame).toContain('bug, frontend');
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

  it('shows priority icon for critical', () => {
    const { lastFrame } = render(
      <DetailPanel
        item={makeItem({ priority: 'critical' })}
        terminalWidth={80}
      />,
    );
    expect(lastFrame()).toContain('▲▲');
    expect(lastFrame()).toContain('critical');
  });

  it('shows priority icon for low', () => {
    const { lastFrame } = render(
      <DetailPanel item={makeItem({ priority: 'low' })} terminalWidth={80} />,
    );
    expect(lastFrame()).toContain('▽');
    expect(lastFrame()).toContain('low');
  });
});
