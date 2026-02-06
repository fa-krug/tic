import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'ink-testing-library';
import { Breadcrumbs } from './Breadcrumbs.js';
import { formStackStore } from '../stores/formStackStore.js';
import type { FormDraft } from '../stores/formStackStore.js';

const createDraft = (itemId: string | null, itemTitle: string): FormDraft => ({
  itemId,
  itemTitle,
  fields: {
    title: '',
    type: 'task',
    status: 'open',
    iteration: 'current',
    priority: 'medium',
    assignee: '',
    labels: '',
    description: '',
    parentId: '',
    dependsOn: '',
    newComment: '',
  },
  initialSnapshot: {
    title: '',
    type: 'task',
    status: 'open',
    iteration: 'current',
    priority: 'medium',
    assignee: '',
    labels: '',
    description: '',
    parentId: '',
    dependsOn: '',
    newComment: '',
  },
  focusedField: 0,
});

beforeEach(() => {
  formStackStore.getState().clear();
});

describe('Breadcrumbs', () => {
  it('renders nothing when stack has 0-1 items', () => {
    const { lastFrame } = render(<Breadcrumbs />);
    expect(lastFrame()).toBe('');
  });

  it('renders breadcrumb trail when stack has multiple items', () => {
    formStackStore.getState().push(createDraft('item-1', 'First Item'));
    formStackStore.getState().push(createDraft('item-2', 'Second Item'));

    const { lastFrame } = render(<Breadcrumbs />);
    expect(lastFrame()).toContain('First Item');
    expect(lastFrame()).toContain('›');
    expect(lastFrame()).toContain('Second Item');
  });

  it('shows (new) for items without id', () => {
    formStackStore.getState().push(createDraft('item-1', 'First Item'));
    formStackStore.getState().push(createDraft(null, '(new)'));

    const { lastFrame } = render(<Breadcrumbs />);
    expect(lastFrame()).toContain('(new)');
  });

  it('truncates long titles', () => {
    formStackStore
      .getState()
      .push(
        createDraft(
          'item-1',
          'This is a very long title that should be truncated',
        ),
      );
    formStackStore.getState().push(createDraft('item-2', 'Short'));

    const { lastFrame } = render(<Breadcrumbs maxTitleLength={20} />);
    expect(lastFrame()).toContain('...');
  });
});
