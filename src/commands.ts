import type { BackendCapabilities } from './backends/types.js';
import type { Screen } from './app.js';

export type KeyDescriptor = string | { special: string; modifier?: 'shift' };

export const CATEGORIES = [
  'Actions',
  'Navigation',
  'Bulk',
  'Switching',
  'Other',
] as const;

export type CommandCategory = (typeof CATEGORIES)[number];

export interface CommandContext {
  screen: Screen;
  markedCount: number;
  hasSelectedItem: boolean;
  capabilities: BackendCapabilities;
  types: string[];
  activeType: string | null;
  hasSyncManager: boolean;
  gitAvailable: boolean;
  hasActiveFilters: boolean;
  hasSavedViews: boolean;
  // Branch list context
  hasSelectedBranch: boolean;
  isCurrentBranch: boolean;
  hasWorktree: boolean;
  hasPrCreateCapability: boolean;
  // PR list context
  hasSelectedPr: boolean;
  // Detail panel context
  showDetailDescription: boolean;
}

export interface Command {
  id: string;
  label: string;
  category: CommandCategory;
  shortcut?: string;
  keys?: KeyDescriptor[];
  screen: Screen | Screen[] | 'global';
  helpGroup?: string;
  footer?: boolean;
  footerLabel?: string;
  when?: (ctx: CommandContext) => boolean;
}

const commands: Command[] = [
  // Actions
  {
    id: 'create',
    label: 'Create new item',
    category: 'Actions',
    shortcut: 'c',
    keys: ['c'],
    screen: 'list',
    helpGroup: 'Actions',
    footer: true,
    footerLabel: 'create',
    when: (ctx) => ctx.screen === 'list',
  },
  {
    id: 'create-child',
    label: 'Create child item',
    category: 'Actions',
    shortcut: 'C',
    keys: ['C'],
    screen: ['list', 'form'],
    helpGroup: 'Actions',
    when: (ctx) =>
      (ctx.screen === 'list' || ctx.screen === 'form') &&
      ctx.hasSelectedItem &&
      ctx.capabilities.fields.parent,
  },
  {
    id: 'edit',
    label: 'Edit selected item',
    category: 'Actions',
    shortcut: 'enter',
    keys: [{ special: 'return' }],
    screen: 'list',
    helpGroup: 'Actions',
    footer: true,
    footerLabel: 'edit',
    when: (ctx) => ctx.screen === 'list' && ctx.hasSelectedItem,
  },
  {
    id: 'list-edit-title',
    label: 'Edit title inline',
    category: 'Actions',
    shortcut: 'T',
    keys: ['T'],
    screen: 'list',
    helpGroup: 'Actions',
    when: (ctx) => ctx.screen === 'list' && ctx.hasSelectedItem,
  },
  {
    id: 'delete',
    label: 'Delete selected item',
    category: 'Actions',
    shortcut: 'd',
    keys: ['d'],
    screen: 'list',
    helpGroup: 'Actions',
    footer: true,
    footerLabel: 'delete',
    when: (ctx) => ctx.screen === 'list' && ctx.hasSelectedItem,
  },
  {
    id: 'open',
    label: 'Open item in browser',
    category: 'Actions',
    shortcut: 'o',
    keys: ['o'],
    screen: 'list',
    helpGroup: 'Actions',
    when: (ctx) => ctx.screen === 'list' && ctx.hasSelectedItem,
  },
  {
    id: 'branch',
    label: 'Create branch or worktree for item',
    category: 'Actions',
    shortcut: 'b',
    keys: ['b'],
    screen: 'list',
    helpGroup: 'Other',
    when: (ctx) =>
      ctx.screen === 'list' && ctx.hasSelectedItem && ctx.gitAvailable,
  },
  {
    id: 'sync',
    label: 'Sync with remote backend',
    category: 'Actions',
    shortcut: 'r',
    keys: ['r'],
    screen: 'list',
    helpGroup: 'Other',
    when: (ctx) => ctx.screen === 'list' && ctx.hasSyncManager,
  },
  {
    id: 'sort',
    label: 'Change sort order',
    category: 'Actions',
    shortcut: 'O',
    keys: ['O'],
    screen: 'list',
    helpGroup: 'Actions',
    when: (ctx) => ctx.screen === 'list',
  },
  // Navigation
  {
    id: 'set-iteration',
    label: 'Assign iteration to item',
    category: 'Actions',
    shortcut: 'i',
    keys: ['i'],
    screen: 'list',
    helpGroup: 'Actions',
    when: (ctx) =>
      ctx.screen === 'list' &&
      ctx.capabilities.iterations &&
      (ctx.hasSelectedItem || ctx.markedCount > 0),
  },
  {
    id: 'switch-iteration',
    label: 'Switch iteration view',
    category: 'Navigation',
    shortcut: 'I',
    keys: ['I'],
    screen: 'list',
    helpGroup: 'Switching',
    when: (ctx) => ctx.screen === 'list' && ctx.capabilities.iterations,
  },
  {
    id: 'settings',
    label: 'Open settings',
    category: 'Navigation',
    shortcut: ',',
    keys: [','],
    screen: 'list',
    helpGroup: 'Switching',
    footer: true,
    footerLabel: 'settings',
    when: (ctx) => ctx.screen === 'list',
  },
  {
    id: 'status',
    label: 'Open sync status',
    category: 'Navigation',
    shortcut: 'S',
    keys: ['S'],
    screen: 'list',
    helpGroup: 'Switching',
    when: (ctx) => ctx.screen === 'list',
  },
  {
    id: 'help',
    label: 'Show keyboard shortcuts',
    category: 'Navigation',
    shortcut: '?',
    keys: ['?'],
    screen: 'global',
    footer: true,
    footerLabel: 'help',
  },
  // Bulk
  {
    id: 'mark',
    label: 'Toggle mark on item',
    category: 'Bulk',
    shortcut: 'm',
    keys: ['m'],
    screen: 'list',
    helpGroup: 'Actions',
    when: (ctx) => ctx.screen === 'list' && ctx.hasSelectedItem,
  },
  {
    id: 'clear-marks',
    label: 'Clear all marks',
    category: 'Bulk',
    shortcut: 'M',
    keys: ['M'],
    screen: 'list',
    helpGroup: 'Bulk',
    when: (ctx) => ctx.screen === 'list' && ctx.markedCount > 0,
  },
  {
    id: 'set-priority',
    label: 'Set item priority',
    category: 'Bulk',
    shortcut: 'y',
    keys: ['y'],
    screen: 'list',
    helpGroup: 'Bulk',
    when: (ctx) =>
      ctx.screen === 'list' &&
      ctx.capabilities.fields.priority &&
      (ctx.hasSelectedItem || ctx.markedCount > 0),
  },
  {
    id: 'set-assignee',
    label: 'Set item assignee',
    category: 'Bulk',
    shortcut: 'a',
    keys: ['a'],
    screen: 'list',
    helpGroup: 'Actions',
    when: (ctx) =>
      ctx.screen === 'list' &&
      ctx.capabilities.fields.assignee &&
      (ctx.hasSelectedItem || ctx.markedCount > 0),
  },
  {
    id: 'set-labels',
    label: 'Set item labels',
    category: 'Bulk',
    shortcut: 'l',
    keys: ['l'],
    screen: 'list',
    helpGroup: 'Actions',
    when: (ctx) =>
      ctx.screen === 'list' &&
      ctx.capabilities.fields.labels &&
      (ctx.hasSelectedItem || ctx.markedCount > 0),
  },
  {
    id: 'set-type',
    label: 'Set item type',
    category: 'Bulk',
    shortcut: 't',
    keys: ['t'],
    screen: 'list',
    helpGroup: 'Bulk',
    when: (ctx) =>
      ctx.screen === 'list' &&
      ctx.capabilities.customTypes &&
      (ctx.hasSelectedItem || ctx.markedCount > 0),
  },
  {
    id: 'bulk-menu',
    label: 'Open bulk actions menu',
    category: 'Bulk',
    shortcut: 'x',
    keys: ['x'],
    screen: 'list',
    helpGroup: 'Bulk',
  },
  {
    id: 'filter',
    label: 'Filter items by field',
    category: 'Actions',
    shortcut: 'F',
    keys: ['F'],
    screen: 'list',
    helpGroup: 'Actions',
    when: (ctx) => ctx.screen === 'list',
  },
  {
    id: 'clear-filters',
    label: 'Clear all active filters',
    category: 'Actions',
    shortcut: 'X',
    keys: ['X'],
    screen: 'list',
    helpGroup: 'Actions',
    when: (ctx) => ctx.screen === 'list' && ctx.hasActiveFilters,
  },
  {
    id: 'load-view',
    label: 'Load a saved view',
    category: 'Actions',
    shortcut: 'V',
    keys: ['V'],
    screen: 'list',
    helpGroup: 'Actions',
    when: (ctx) => ctx.screen === 'list',
  },
  {
    id: 'save-view',
    label: 'Save current filters as a view',
    category: 'Actions',
    screen: 'list',
    when: (ctx) => ctx.screen === 'list' && ctx.hasActiveFilters,
  },
  {
    id: 'delete-view',
    label: 'Delete a saved view',
    category: 'Actions',
    screen: 'list',
    when: (ctx) => ctx.screen === 'list' && ctx.hasSavedViews,
  },
  // List-screen navigation
  {
    id: 'list-navigate',
    label: 'Move cursor up/down',
    category: 'Navigation',
    shortcut: '↑/↓',
    keys: [{ special: 'upArrow' }, { special: 'downArrow' }],
    screen: 'list',
    helpGroup: 'Navigation',
    footer: true,
    footerLabel: 'navigate',
  },
  {
    id: 'list-page',
    label: 'Scroll one page up/down',
    category: 'Navigation',
    shortcut: 'pgup/pgdn',
    keys: [{ special: 'pageUp' }, { special: 'pageDown' }],
    screen: 'list',
    helpGroup: 'Navigation',
  },
  {
    id: 'list-home-end',
    label: 'Jump to first/last item',
    category: 'Navigation',
    shortcut: 'home/end',
    keys: [{ special: 'home' }, { special: 'end' }],
    screen: 'list',
    helpGroup: 'Navigation',
  },
  {
    id: 'list-collapse',
    label: 'Collapse node or jump to parent',
    category: 'Navigation',
    shortcut: '←',
    keys: [{ special: 'leftArrow' }],
    screen: 'list',
    helpGroup: 'Navigation',
    when: (ctx) => ctx.capabilities.relationships,
  },
  {
    id: 'list-expand',
    label: 'Expand child items',
    category: 'Navigation',
    shortcut: '→',
    keys: [{ special: 'rightArrow' }],
    screen: 'list',
    helpGroup: 'Navigation',
    when: (ctx) => ctx.capabilities.relationships,
  },
  // List-screen actions missing from registry
  {
    id: 'list-undo',
    label: 'Undo last change',
    category: 'Actions',
    shortcut: 'u',
    keys: ['u'],
    screen: 'list',
    helpGroup: 'Actions',
    footer: true,
    footerLabel: 'undo',
  },
  {
    id: 'list-status',
    label: 'Set item status',
    category: 'Actions',
    shortcut: 's',
    keys: ['s'],
    screen: 'list',
    helpGroup: 'Actions',
  },
  {
    id: 'list-parent',
    label: 'Set item parent',
    category: 'Actions',
    shortcut: 'g',
    keys: ['g'],
    screen: 'list',
    helpGroup: 'Actions',
    when: (ctx) => ctx.capabilities.fields.parent,
  },
  {
    id: 'list-pr-create',
    label: 'Create pull request for item',
    category: 'Actions',
    shortcut: 'p',
    keys: ['p'],
    screen: 'list',
    helpGroup: 'Actions',
  },
  {
    id: 'list-pr-list',
    label: 'Open pull request list',
    category: 'Navigation',
    shortcut: 'P',
    keys: ['P'],
    screen: 'list',
    helpGroup: 'Actions',
  },
  {
    id: 'list-branch-manage',
    label: 'Open branch manager',
    category: 'Navigation',
    shortcut: 'B',
    keys: ['B'],
    screen: 'list',
    helpGroup: 'Actions',
    when: (ctx) => ctx.gitAvailable,
  },
  {
    id: 'list-range-select',
    label: 'Extend selection up/down',
    category: 'Bulk',
    shortcut: 'shift+↑↓',
    keys: [
      { special: 'upArrow', modifier: 'shift' },
      { special: 'downArrow', modifier: 'shift' },
    ],
    screen: 'list',
    helpGroup: 'Actions',
  },
  {
    id: 'list-tab',
    label: 'Cycle through work item types',
    category: 'Switching',
    shortcut: 'tab',
    keys: [{ special: 'tab' }],
    screen: 'list',
    helpGroup: 'Switching',
    when: (ctx) => ctx.capabilities.customTypes,
  },
  {
    id: 'list-toggle-description',
    label: 'Toggle inline description preview',
    category: 'Other',
    shortcut: 'space',
    keys: [' '],
    screen: 'list',
    helpGroup: 'Other',
  },
  {
    id: 'desc-edit',
    label: 'Edit description',
    category: 'Other',
    shortcut: 'enter',
    screen: 'list',
    helpGroup: 'Description Preview',
    footer: true,
    when: (ctx) => ctx.showDetailDescription,
  },
  {
    id: 'desc-half-page-down',
    label: 'Half page down',
    category: 'Other',
    shortcut: 'd',
    screen: 'list',
    helpGroup: 'Description Preview',
    footer: true,
    when: (ctx) => ctx.showDetailDescription,
  },
  {
    id: 'desc-half-page-up',
    label: 'Half page up',
    category: 'Other',
    shortcut: 'u',
    screen: 'list',
    helpGroup: 'Description Preview',
    footer: true,
    when: (ctx) => ctx.showDetailDescription,
  },
  {
    id: 'desc-page-down',
    label: 'Page down',
    category: 'Other',
    shortcut: 'shift+↓',
    screen: 'list',
    helpGroup: 'Description Preview',
    when: (ctx) => ctx.showDetailDescription,
  },
  {
    id: 'desc-page-up',
    label: 'Page up',
    category: 'Other',
    shortcut: 'shift+↑',
    screen: 'list',
    helpGroup: 'Description Preview',
    when: (ctx) => ctx.showDetailDescription,
  },
  {
    id: 'desc-top',
    label: 'Go to top',
    category: 'Other',
    shortcut: 'g',
    screen: 'list',
    helpGroup: 'Description Preview',
    when: (ctx) => ctx.showDetailDescription,
  },
  {
    id: 'desc-bottom',
    label: 'Go to bottom',
    category: 'Other',
    shortcut: 'G',
    screen: 'list',
    helpGroup: 'Description Preview',
    when: (ctx) => ctx.showDetailDescription,
  },
  {
    id: 'list-command-bar',
    label: 'Search / command bar',
    category: 'Actions',
    shortcut: '/',
    keys: ['/'],
    screen: 'list',
    helpGroup: 'Actions',
    footer: true,
    footerLabel: 'search',
  },
  // Navigation shared across sub-screens
  {
    id: 'nav-back',
    label: 'Go back to item list',
    category: 'Navigation',
    shortcut: 'esc',
    keys: [{ special: 'escape' }],
    screen: ['pr-list', 'branch-list', 'iteration-picker'],
    helpGroup: 'Navigation',
    footer: true,
    footerLabel: 'back',
    when: (ctx) =>
      ctx.screen === 'pr-list' ||
      ctx.screen === 'branch-list' ||
      ctx.screen === 'iteration-picker',
  },
  // Iteration picker actions
  {
    id: 'iteration-navigate',
    label: 'Move cursor up/down',
    category: 'Navigation',
    shortcut: 'j/k',
    keys: [{ special: 'upArrow' }, { special: 'downArrow' }],
    screen: 'iteration-picker',
    helpGroup: 'Navigation',
    footer: true,
    footerLabel: 'navigate',
  },
  {
    id: 'iteration-select',
    label: 'Select iteration',
    category: 'Actions',
    shortcut: 'enter',
    keys: [{ special: 'return' }],
    screen: 'iteration-picker',
    helpGroup: 'Actions',
    footer: true,
    footerLabel: 'switch',
  },
  // Branch list actions
  {
    id: 'branch-navigate',
    label: 'Move cursor up/down',
    category: 'Navigation',
    shortcut: 'j/k',
    keys: [{ special: 'upArrow' }, { special: 'downArrow' }],
    screen: 'branch-list',
    helpGroup: 'Navigation',
    footer: true,
    footerLabel: 'navigate',
  },
  {
    id: 'branch-search',
    label: 'Search branch list',
    category: 'Actions',
    shortcut: '/',
    keys: ['/'],
    screen: 'branch-list',
    helpGroup: 'Actions',
    footer: true,
    footerLabel: 'search',
  },
  {
    id: 'branch-switch',
    label: 'Switch to branch',
    category: 'Actions',
    shortcut: 'enter',
    keys: [{ special: 'return' }],
    screen: 'branch-list',
    helpGroup: 'Actions',
    footer: true,
    footerLabel: 'switch',
    when: (ctx) =>
      ctx.screen === 'branch-list' &&
      ctx.hasSelectedBranch &&
      !ctx.isCurrentBranch,
  },
  {
    id: 'branch-create',
    label: 'Create new branch',
    category: 'Actions',
    shortcut: 'c',
    keys: ['c'],
    screen: 'branch-list',
    helpGroup: 'Actions',
    footer: true,
    footerLabel: 'new',
    when: (ctx) => ctx.screen === 'branch-list',
  },
  {
    id: 'branch-delete',
    label: 'Delete branch',
    category: 'Actions',
    shortcut: 'd',
    keys: ['d'],
    screen: 'branch-list',
    helpGroup: 'Actions',
    footer: true,
    footerLabel: 'delete',
    when: (ctx) =>
      ctx.screen === 'branch-list' &&
      ctx.hasSelectedBranch &&
      !ctx.isCurrentBranch,
  },
  {
    id: 'branch-merge',
    label: 'Merge branch into current',
    category: 'Actions',
    shortcut: 'm',
    keys: ['m'],
    screen: 'branch-list',
    helpGroup: 'Actions',
    footer: true,
    footerLabel: 'merge',
    when: (ctx) =>
      ctx.screen === 'branch-list' &&
      ctx.hasSelectedBranch &&
      !ctx.isCurrentBranch,
  },
  {
    id: 'branch-push',
    label: 'Push branch to remote',
    category: 'Actions',
    shortcut: 'P',
    keys: ['P'],
    screen: 'branch-list',
    helpGroup: 'Actions',
    footer: true,
    footerLabel: 'push',
    when: (ctx) => ctx.screen === 'branch-list' && ctx.hasSelectedBranch,
  },
  {
    id: 'branch-create-pr',
    label: 'Create pull request for branch',
    category: 'Actions',
    shortcut: 'p',
    keys: ['p'],
    screen: 'branch-list',
    helpGroup: 'Actions',
    when: (ctx) =>
      ctx.screen === 'branch-list' &&
      ctx.hasSelectedBranch &&
      ctx.hasPrCreateCapability,
  },
  {
    id: 'branch-worktree',
    label: 'Open worktree shell',
    category: 'Actions',
    shortcut: 'w',
    keys: ['w'],
    screen: 'branch-list',
    helpGroup: 'Actions',
    footer: true,
    footerLabel: 'worktree',
    when: (ctx) =>
      ctx.screen === 'branch-list' && ctx.hasSelectedBranch && ctx.hasWorktree,
  },
  {
    id: 'branch-refresh',
    label: 'Refresh and fetch from remote',
    category: 'Actions',
    shortcut: 'r',
    keys: ['r'],
    screen: 'branch-list',
    helpGroup: 'Actions',
    footer: true,
    footerLabel: 'refresh',
    when: (ctx) => ctx.screen === 'branch-list',
  },
  // PR list actions
  {
    id: 'pr-navigate',
    label: 'Move cursor up/down',
    category: 'Navigation',
    shortcut: 'j/k',
    keys: [{ special: 'upArrow' }, { special: 'downArrow' }],
    screen: 'pr-list',
    helpGroup: 'Navigation',
    footer: true,
    footerLabel: 'navigate',
  },
  {
    id: 'pr-open',
    label: 'Open in browser',
    category: 'Actions',
    shortcut: 'enter/o',
    keys: ['o', { special: 'return' }],
    screen: 'pr-list',
    helpGroup: 'Actions',
    footer: true,
    footerLabel: 'open',
    when: (ctx) => ctx.screen === 'pr-list' && ctx.hasSelectedPr,
  },
  {
    id: 'pr-search',
    label: 'Search pull request list',
    category: 'Actions',
    shortcut: '/',
    keys: ['/'],
    screen: 'pr-list',
    helpGroup: 'Actions',
    footer: true,
    footerLabel: 'search',
  },
  // Form commands
  {
    id: 'form-navigate',
    label: 'Move between form fields',
    category: 'Navigation',
    shortcut: '↑/↓',
    keys: [{ special: 'upArrow' }, { special: 'downArrow' }],
    screen: 'form',
    helpGroup: 'Navigation',
  },
  {
    id: 'form-edit',
    label: 'Edit field, open editor, or follow link',
    category: 'Actions',
    shortcut: 'enter',
    keys: [{ special: 'return' }],
    screen: 'form',
    helpGroup: 'Editing',
  },
  {
    id: 'form-revert',
    label: 'Revert field to previous value',
    category: 'Actions',
    shortcut: 'esc',
    keys: [{ special: 'escape' }],
    screen: 'form',
    helpGroup: 'Editing',
  },
  {
    id: 'form-confirm',
    label: 'Confirm field edit',
    category: 'Actions',
    shortcut: 'enter/select',
    screen: 'form',
    helpGroup: 'Editing',
  },
  {
    id: 'form-save',
    label: 'Save changes and go back',
    category: 'Actions',
    shortcut: 's',
    keys: ['s'],
    screen: 'form',
    helpGroup: 'Save & Exit',
  },
  {
    id: 'form-back',
    label: 'Go back (save/discard prompt if changed)',
    category: 'Navigation',
    shortcut: 'esc',
    keys: [{ special: 'escape' }],
    screen: 'form',
    helpGroup: 'Save & Exit',
  },
  // Settings commands
  {
    id: 'settings-navigate',
    label: 'Move between options',
    category: 'Navigation',
    shortcut: '↑/↓',
    keys: [{ special: 'upArrow' }, { special: 'downArrow' }],
    screen: 'settings',
    helpGroup: 'Navigation',
  },
  {
    id: 'settings-select',
    label: 'Select or edit option',
    category: 'Actions',
    shortcut: 'enter',
    keys: [{ special: 'return' }],
    screen: 'settings',
    helpGroup: 'Navigation',
  },
  {
    id: 'settings-back',
    label: 'Go back',
    category: 'Navigation',
    shortcut: 'esc/,',
    keys: [{ special: 'escape' }, ','],
    screen: 'settings',
    helpGroup: 'Navigation',
  },
  {
    id: 'settings-edit',
    label: 'Type to edit field value',
    category: 'Actions',
    shortcut: 'type',
    screen: 'settings',
    helpGroup: 'Editing',
  },
  {
    id: 'settings-confirm',
    label: 'Confirm',
    category: 'Actions',
    shortcut: 'enter/esc',
    screen: 'settings',
    helpGroup: 'Editing',
  },
  {
    id: 'settings-update',
    label: 'Check for tic updates',
    category: 'Actions',
    shortcut: 'u',
    keys: ['u'],
    screen: 'settings',
    helpGroup: 'Actions',
  },
  {
    id: 'settings-create-template',
    label: 'Create template',
    category: 'Actions',
    shortcut: 'c',
    keys: ['c'],
    screen: 'settings',
    helpGroup: 'Templates',
    when: (ctx) => ctx.capabilities.templates,
  },
  {
    id: 'settings-delete-template',
    label: 'Delete template',
    category: 'Actions',
    shortcut: 'd',
    keys: ['d'],
    screen: 'settings',
    helpGroup: 'Templates',
    when: (ctx) => ctx.capabilities.templates,
  },
  {
    id: 'settings-edit-template',
    label: 'Edit template',
    category: 'Actions',
    shortcut: 'enter',
    keys: [{ special: 'return' }],
    screen: 'settings',
    helpGroup: 'Templates',
    when: (ctx) => ctx.capabilities.templates,
  },
  // Status screen commands
  {
    id: 'status-scroll',
    label: 'Scroll error details',
    category: 'Navigation',
    shortcut: '↑/↓',
    keys: [{ special: 'upArrow' }, { special: 'downArrow' }],
    screen: 'status',
    helpGroup: 'Navigation',
  },
  {
    id: 'status-back',
    label: 'Go back',
    category: 'Navigation',
    shortcut: 'esc/q',
    keys: [{ special: 'escape' }, 'q'],
    screen: 'status',
    helpGroup: 'Navigation',
  },
  {
    id: 'status-retry',
    label: 'Retry failed sync',
    category: 'Actions',
    shortcut: 'r',
    keys: ['r'],
    screen: 'status',
    helpGroup: 'Actions',
    when: (ctx) => ctx.hasSyncManager,
  },
  // Other
  {
    id: 'toggle-detail-panel',
    label: 'Toggle side detail panel',
    category: 'Other',
    shortcut: 'v',
    keys: ['v'],
    screen: 'list',
    helpGroup: 'Other',
    when: (ctx) => ctx.screen === 'list',
  },
  {
    id: 'quit',
    label: 'Quit',
    category: 'Other',
    shortcut: 'q',
    keys: ['q'],
    screen: 'global',
    helpGroup: 'Other',
    when: () => true,
  },
  // Editor commands
  {
    id: 'editor-save',
    label: 'Save and return',
    category: 'Actions',
    shortcut: 'Ctrl+S',
    keys: [],
    screen: 'editor',
    helpGroup: 'Editor',
  },
  {
    id: 'editor-cancel',
    label: 'Cancel and return',
    category: 'Navigation',
    shortcut: 'Esc',
    keys: [],
    screen: 'editor',
    helpGroup: 'Editor',
  },
  {
    id: 'editor-undo',
    label: 'Undo',
    category: 'Actions',
    shortcut: 'Ctrl+Z',
    keys: [],
    screen: 'editor',
    helpGroup: 'Editor',
  },
  {
    id: 'editor-redo',
    label: 'Redo',
    category: 'Actions',
    shortcut: 'Ctrl+Shift+Z',
    keys: [],
    screen: 'editor',
    helpGroup: 'Editor',
  },
  // Help screen commands
  {
    id: 'help-scroll',
    label: 'Scroll up/down',
    category: 'Navigation',
    keys: [{ special: 'upArrow' }, { special: 'downArrow' }],
    shortcut: '↑/↓',
    screen: 'help',
    helpGroup: 'Navigation',
  },
  {
    id: 'help-back',
    label: 'Go back',
    category: 'Navigation',
    keys: [{ special: 'escape' }],
    shortcut: 'esc',
    screen: 'help',
    helpGroup: 'Navigation',
    footer: true,
    footerLabel: 'back',
  },
];

export interface CommandGroup {
  category: string;
  commands: Command[];
}

export function filterCommands(commands: Command[], query: string): Command[] {
  if (query.trim() === '') return commands;
  const q = query.toLowerCase();
  return commands.filter((cmd) => cmd.label.toLowerCase().includes(q));
}

export function groupCommandsByCategory(commands: Command[]): CommandGroup[] {
  const groups: CommandGroup[] = [];
  for (const category of CATEGORIES) {
    const cmds = commands.filter((c) => c.category === category);
    if (cmds.length > 0) {
      groups.push({ category, commands: cmds });
    }
  }
  return groups;
}

export function getVisibleCommands(ctx: CommandContext): Command[] {
  const visible = commands.filter((cmd) => !cmd.when || cmd.when(ctx));

  // Add dynamic switch-type commands
  if (ctx.screen === 'list' && ctx.capabilities.customTypes) {
    for (const type of ctx.types) {
      if (type === ctx.activeType) continue;
      const plural = type + 's';
      visible.push({
        id: `switch-${type}`,
        label: `Switch to ${plural}`,
        category: 'Switching',
        shortcut: 'tab',
        screen: 'list',
        when: () => true,
      });
    }
  }

  return visible;
}

export function findCommand(id: string): Command | undefined {
  return commands.find((cmd) => cmd.id === id);
}

export function getCommandsForScreen(
  screen: Screen,
  ctx: CommandContext,
): Command[] {
  return commands.filter((cmd) => {
    const screens = cmd.screen;
    if (screens === 'global') {
      // global matches all
    } else if (Array.isArray(screens)) {
      if (!screens.includes(screen)) return false;
    } else {
      if (screens !== screen) return false;
    }
    if (cmd.when && !cmd.when(ctx)) return false;
    return true;
  });
}

export function getFooterCommands(
  screen: Screen,
  ctx: CommandContext,
): Command[] {
  return getCommandsForScreen(screen, ctx).filter((cmd) => cmd.footer);
}

export function buildFooterHints(
  screen: Screen,
  ctx: CommandContext,
  availableWidth: number,
): string {
  const footerCmds = getFooterCommands(screen, ctx);
  const sep = ' │ ';
  let result = '';
  for (const cmd of footerCmds) {
    if (!cmd.shortcut) continue;
    const label = cmd.footerLabel ?? cmd.label;
    const entry = `${cmd.shortcut} ${label}`;
    const candidate = result ? result + sep + entry : entry;
    if (candidate.length > availableWidth) break;
    result = candidate;
  }
  return result;
}

export function matchesCommand(
  id: string,
  input: string,
  key: Record<string, boolean>,
): boolean {
  const cmd = findCommand(id);
  if (!cmd?.keys) return false;
  return cmd.keys.some((k) => {
    if (typeof k === 'string') return input === k;
    if (k.modifier === 'shift') return key[k.special] && key['shift'];
    return key[k.special] && !key['shift'];
  });
}

export interface ShortcutGroup {
  label: string;
  shortcuts: { key: string; description: string }[];
}

export function groupByHelpGroup(commands: Command[]): ShortcutGroup[] {
  const groups: ShortcutGroup[] = [];
  const seen = new Map<string, ShortcutGroup>();
  for (const cmd of commands) {
    if (!cmd.helpGroup || !cmd.shortcut) continue;
    let group = seen.get(cmd.helpGroup);
    if (!group) {
      group = { label: cmd.helpGroup, shortcuts: [] };
      seen.set(cmd.helpGroup, group);
      groups.push(group);
    }
    group.shortcuts.push({ key: cmd.shortcut, description: cmd.label });
  }
  return groups;
}
