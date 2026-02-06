import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type { Template } from '../types.js';
import type { UpdateInfo } from '../update-checker.js';
import { uiStore } from './uiStore.js';

export type Screen =
  | 'list'
  | 'form'
  | 'iteration-picker'
  | 'settings'
  | 'status'
  | 'help';

interface NavigationState {
  // Screen routing
  screen: Screen;
  previousScreen: Screen;

  // Work item selection
  selectedWorkItemId: string | null;
  navigationStack: string[];

  // Form context
  activeType: string | null;
  activeTemplate: Template | null;
  formMode: 'item' | 'template';
  editingTemplateSlug: string | null;

  // Update info
  updateInfo: UpdateInfo | null;

  // Actions
  navigate: (screen: Screen) => void;
  navigateToHelp: () => void;
  navigateBackFromHelp: () => void;
  selectWorkItem: (id: string | null) => void;
  pushWorkItem: (id: string) => void;
  popWorkItem: () => string | null;
  setActiveType: (type: string | null) => void;
  setActiveTemplate: (template: Template | null) => void;
  setFormMode: (mode: 'item' | 'template') => void;
  setEditingTemplateSlug: (slug: string | null) => void;
  setUpdateInfo: (info: UpdateInfo | null) => void;
  reset: () => void;
}

const initialState = {
  screen: 'list' as Screen,
  previousScreen: 'list' as Screen,
  selectedWorkItemId: null,
  navigationStack: [],
  activeType: null,
  activeTemplate: null,
  formMode: 'item' as const,
  editingTemplateSlug: null,
  updateInfo: null,
};

const createNavigationStore = () =>
  createStore<NavigationState>((set, get) => ({
    ...initialState,

    navigate: (newScreen: Screen) => {
      uiStore.getState().reset();
      const clearStack = newScreen !== 'form';
      set((state) => ({
        screen: newScreen,
        navigationStack: clearStack ? [] : state.navigationStack,
      }));
    },

    navigateToHelp: () => {
      set((state) => ({
        previousScreen: state.screen,
        screen: 'help',
      }));
    },

    navigateBackFromHelp: () => {
      set((state) => ({
        screen: state.previousScreen,
      }));
    },

    selectWorkItem: (id: string | null) => {
      set({ selectedWorkItemId: id });
    },

    pushWorkItem: (id: string) => {
      set((state) => ({
        navigationStack: state.selectedWorkItemId
          ? [...state.navigationStack, state.selectedWorkItemId]
          : state.navigationStack,
        selectedWorkItemId: id,
      }));
    },

    popWorkItem: () => {
      const { navigationStack } = get();
      if (navigationStack.length === 0) return null;
      const prev = navigationStack[navigationStack.length - 1]!;
      set((state) => ({
        navigationStack: state.navigationStack.slice(0, -1),
        selectedWorkItemId: prev,
      }));
      return prev;
    },

    setActiveType: (type: string | null) => {
      set({ activeType: type });
    },

    setActiveTemplate: (template: Template | null) => {
      set({ activeTemplate: template });
    },

    setFormMode: (mode: 'item' | 'template') => {
      set({ formMode: mode });
    },

    setEditingTemplateSlug: (slug: string | null) => {
      set({ editingTemplateSlug: slug });
    },

    setUpdateInfo: (info: UpdateInfo | null) => {
      set({ updateInfo: info });
    },

    reset: () => {
      set(initialState);
    },
  }));

export const navigationStore = createNavigationStore();

export function useNavigationStore<T>(
  selector: (state: NavigationState) => T,
): T {
  return useStore(navigationStore, selector);
}
