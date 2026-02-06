import { describe, it, expect, beforeEach } from 'vitest';
import { navigationStore } from './navigationStore.js';
import { uiStore } from './uiStore.js';
import { formStackStore } from './formStackStore.js';

beforeEach(() => {
  navigationStore.getState().reset();
  uiStore.getState().reset();
  formStackStore.getState().clear();
});

describe('navigationStore', () => {
  describe('navigate', () => {
    it('changes screen', () => {
      navigationStore.getState().navigate('settings');
      expect(navigationStore.getState().screen).toBe('settings');
    });

    it('resets UI overlays', () => {
      uiStore.getState().openOverlay({ type: 'search' });
      navigationStore.getState().navigate('settings');
      expect(uiStore.getState().activeOverlay).toBeNull();
    });

    it('clears navigation stack when leaving form', () => {
      navigationStore.setState({
        screen: 'form',
        navigationStack: ['item-1', 'item-2'],
      });
      navigationStore.getState().navigate('list');
      expect(navigationStore.getState().navigationStack).toEqual([]);
    });

    it('preserves navigation stack when navigating to form', () => {
      navigationStore.setState({ navigationStack: ['item-1'] });
      navigationStore.getState().navigate('form');
      expect(navigationStore.getState().navigationStack).toEqual(['item-1']);
    });

    it('clears form stack when navigating away from form', () => {
      formStackStore.getState().push({
        itemId: 'item-1',
        itemTitle: 'Test',
        fields: {
          title: 'Test',
          type: 'task',
          status: 'open',
          iteration: '',
          priority: '',
          assignee: '',
          labels: '',
          description: '',
          parentId: '',
          dependsOn: '',
          newComment: '',
        },
        initialSnapshot: {
          title: 'Test',
          type: 'task',
          status: 'open',
          iteration: '',
          priority: '',
          assignee: '',
          labels: '',
          description: '',
          parentId: '',
          dependsOn: '',
          newComment: '',
        },
        focusedField: 0,
      });
      navigationStore.setState({ screen: 'form' });
      navigationStore.getState().navigate('list');
      expect(formStackStore.getState().stack).toHaveLength(0);
    });

    it('preserves form stack when navigating to form', () => {
      formStackStore.getState().push({
        itemId: 'item-1',
        itemTitle: 'Test',
        fields: {
          title: 'Test',
          type: 'task',
          status: 'open',
          iteration: '',
          priority: '',
          assignee: '',
          labels: '',
          description: '',
          parentId: '',
          dependsOn: '',
          newComment: '',
        },
        initialSnapshot: {
          title: 'Test',
          type: 'task',
          status: 'open',
          iteration: '',
          priority: '',
          assignee: '',
          labels: '',
          description: '',
          parentId: '',
          dependsOn: '',
          newComment: '',
        },
        focusedField: 0,
      });
      navigationStore.getState().navigate('form');
      expect(formStackStore.getState().stack).toHaveLength(1);
    });
  });

  describe('navigateToHelp / navigateBackFromHelp', () => {
    it('saves previous screen and navigates to help', () => {
      navigationStore.setState({ screen: 'settings' });
      navigationStore.getState().navigateToHelp();
      expect(navigationStore.getState().screen).toBe('help');
      expect(navigationStore.getState().previousScreen).toBe('settings');
    });

    it('returns to previous screen', () => {
      navigationStore.setState({ screen: 'help', previousScreen: 'settings' });
      navigationStore.getState().navigateBackFromHelp();
      expect(navigationStore.getState().screen).toBe('settings');
    });
  });

  describe('selectWorkItem', () => {
    it('sets selected work item id', () => {
      navigationStore.getState().selectWorkItem('item-123');
      expect(navigationStore.getState().selectedWorkItemId).toBe('item-123');
    });

    it('clears selected work item id', () => {
      navigationStore.setState({ selectedWorkItemId: 'item-123' });
      navigationStore.getState().selectWorkItem(null);
      expect(navigationStore.getState().selectedWorkItemId).toBeNull();
    });
  });

  describe('pushWorkItem', () => {
    it('pushes current item to stack and selects new', () => {
      navigationStore.setState({ selectedWorkItemId: 'item-1' });
      navigationStore.getState().pushWorkItem('item-2');

      expect(navigationStore.getState().selectedWorkItemId).toBe('item-2');
      expect(navigationStore.getState().navigationStack).toEqual(['item-1']);
    });

    it('does not push null to stack', () => {
      navigationStore.setState({ selectedWorkItemId: null });
      navigationStore.getState().pushWorkItem('item-1');

      expect(navigationStore.getState().selectedWorkItemId).toBe('item-1');
      expect(navigationStore.getState().navigationStack).toEqual([]);
    });

    it('builds up navigation stack', () => {
      navigationStore.getState().pushWorkItem('item-1');
      navigationStore.getState().pushWorkItem('item-2');
      navigationStore.getState().pushWorkItem('item-3');

      expect(navigationStore.getState().selectedWorkItemId).toBe('item-3');
      expect(navigationStore.getState().navigationStack).toEqual([
        'item-1',
        'item-2',
      ]);
    });
  });

  describe('popWorkItem', () => {
    it('pops from stack and returns previous item', () => {
      navigationStore.setState({
        selectedWorkItemId: 'item-2',
        navigationStack: ['item-1'],
      });

      const prev = navigationStore.getState().popWorkItem();

      expect(prev).toBe('item-1');
      expect(navigationStore.getState().selectedWorkItemId).toBe('item-1');
      expect(navigationStore.getState().navigationStack).toEqual([]);
    });

    it('returns null when stack is empty', () => {
      navigationStore.setState({
        selectedWorkItemId: 'item-1',
        navigationStack: [],
      });

      const prev = navigationStore.getState().popWorkItem();

      expect(prev).toBeNull();
      expect(navigationStore.getState().selectedWorkItemId).toBe('item-1');
    });
  });

  describe('form context setters', () => {
    it('sets activeType', () => {
      navigationStore.getState().setActiveType('bug');
      expect(navigationStore.getState().activeType).toBe('bug');
    });

    it('sets activeTemplate', () => {
      const template = { slug: 'test', name: 'Test', description: '' };
      navigationStore.getState().setActiveTemplate(template);
      expect(navigationStore.getState().activeTemplate).toEqual(template);
    });

    it('sets formMode', () => {
      navigationStore.getState().setFormMode('template');
      expect(navigationStore.getState().formMode).toBe('template');
    });

    it('sets editingTemplateSlug', () => {
      navigationStore.getState().setEditingTemplateSlug('my-template');
      expect(navigationStore.getState().editingTemplateSlug).toBe(
        'my-template',
      );
    });

    it('sets updateInfo', () => {
      const info = { current: '1.0.0', latest: '2.0.0', updateAvailable: true };
      navigationStore.getState().setUpdateInfo(info);
      expect(navigationStore.getState().updateInfo).toEqual(info);
    });
  });

  describe('reset', () => {
    it('resets all state to initial values', () => {
      navigationStore.setState({
        screen: 'settings',
        previousScreen: 'form',
        selectedWorkItemId: 'item-1',
        navigationStack: ['item-0'],
        activeType: 'bug',
        activeTemplate: { slug: 'test', name: 'Test', description: '' },
        formMode: 'template',
        editingTemplateSlug: 'my-template',
        updateInfo: {
          current: '1.0.0',
          latest: '2.0.0',
          updateAvailable: true,
        },
      });

      navigationStore.getState().reset();

      expect(navigationStore.getState().screen).toBe('list');
      expect(navigationStore.getState().previousScreen).toBe('list');
      expect(navigationStore.getState().selectedWorkItemId).toBeNull();
      expect(navigationStore.getState().navigationStack).toEqual([]);
      expect(navigationStore.getState().activeType).toBeNull();
      expect(navigationStore.getState().activeTemplate).toBeNull();
      expect(navigationStore.getState().formMode).toBe('item');
      expect(navigationStore.getState().editingTemplateSlug).toBeNull();
      expect(navigationStore.getState().updateInfo).toBeNull();
    });
  });
});
