import { describe, it, expect, beforeEach } from 'vitest';
import { formStackStore } from './formStackStore.js';
import type { FormDraft } from './formStackStore.js';

const createDraft = (overrides: Partial<FormDraft> = {}): FormDraft => ({
  itemId: null,
  itemTitle: '(new)',
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
  ...overrides,
});

beforeEach(() => {
  formStackStore.getState().clear();
});

describe('formStackStore', () => {
  describe('push', () => {
    it('adds draft to stack', () => {
      const draft = createDraft({ itemId: 'item-1', itemTitle: 'Test' });
      formStackStore.getState().push(draft);
      expect(formStackStore.getState().stack).toHaveLength(1);
      expect(formStackStore.getState().stack[0]).toEqual(draft);
    });

    it('builds up stack with multiple pushes', () => {
      formStackStore.getState().push(createDraft({ itemId: 'item-1' }));
      formStackStore.getState().push(createDraft({ itemId: 'item-2' }));
      expect(formStackStore.getState().stack).toHaveLength(2);
    });
  });

  describe('pop', () => {
    it('removes and returns top draft', () => {
      const draft1 = createDraft({ itemId: 'item-1' });
      const draft2 = createDraft({ itemId: 'item-2' });
      formStackStore.getState().push(draft1);
      formStackStore.getState().push(draft2);

      const popped = formStackStore.getState().pop();
      expect(popped).toEqual(draft2);
      expect(formStackStore.getState().stack).toHaveLength(1);
    });

    it('returns undefined when stack is empty', () => {
      const popped = formStackStore.getState().pop();
      expect(popped).toBeUndefined();
    });
  });

  describe('currentDraft', () => {
    it('returns top of stack', () => {
      const draft = createDraft({ itemId: 'item-1' });
      formStackStore.getState().push(draft);
      expect(formStackStore.getState().currentDraft()).toEqual(draft);
    });

    it('returns undefined when empty', () => {
      expect(formStackStore.getState().currentDraft()).toBeUndefined();
    });
  });

  describe('updateFields', () => {
    it('updates fields in current draft', () => {
      formStackStore.getState().push(createDraft());
      formStackStore.getState().updateFields({ title: 'Updated' });
      expect(formStackStore.getState().currentDraft()?.fields.title).toBe(
        'Updated',
      );
    });

    it('does nothing when stack is empty', () => {
      formStackStore.getState().updateFields({ title: 'Test' });
      expect(formStackStore.getState().stack).toHaveLength(0);
    });
  });

  describe('setFocusedField', () => {
    it('updates focusedField in current draft', () => {
      formStackStore.getState().push(createDraft());
      formStackStore.getState().setFocusedField(5);
      expect(formStackStore.getState().currentDraft()?.focusedField).toBe(5);
    });
  });

  describe('isDirty', () => {
    it('returns false when fields match snapshot', () => {
      formStackStore.getState().push(createDraft());
      expect(formStackStore.getState().isDirty()).toBe(false);
    });

    it('returns true when fields differ from snapshot', () => {
      formStackStore.getState().push(createDraft());
      formStackStore.getState().updateFields({ title: 'Changed' });
      expect(formStackStore.getState().isDirty()).toBe(true);
    });

    it('returns false when stack is empty', () => {
      expect(formStackStore.getState().isDirty()).toBe(false);
    });
  });

  describe('showDiscardPrompt', () => {
    it('sets and clears discard prompt state', () => {
      formStackStore.getState().setShowDiscardPrompt(true);
      expect(formStackStore.getState().showDiscardPrompt).toBe(true);
      formStackStore.getState().setShowDiscardPrompt(false);
      expect(formStackStore.getState().showDiscardPrompt).toBe(false);
    });
  });

  describe('clear', () => {
    it('resets all state', () => {
      formStackStore.getState().push(createDraft());
      formStackStore.getState().setShowDiscardPrompt(true);
      formStackStore.getState().clear();

      expect(formStackStore.getState().stack).toHaveLength(0);
      expect(formStackStore.getState().showDiscardPrompt).toBe(false);
    });
  });
});
