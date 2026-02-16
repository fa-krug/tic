import type { BackendCapabilities } from './backends/types.js';
import type { Screen } from './app.js';

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
}

export interface Command {
  id: string;
  label: string;
  category: CommandCategory;
  shortcut?: string;
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
    label: 'Create item',
    category: 'Actions',
    shortcut: 'c',
    screen: 'list',
    helpGroup: 'Actions',
    footer: true,
    footerLabel: 'create',
    when: (ctx) => ctx.screen === 'list',
  },
  {
    id: 'edit',
    label: 'Edit item',
    category: 'Actions',
    shortcut: 'enter',
    screen: 'list',
    helpGroup: 'Actions',
    footer: true,
    footerLabel: 'edit',
    when: (ctx) => ctx.screen === 'list' && ctx.hasSelectedItem,
  },
  {
    id: 'delete',
    label: 'Delete item',
    category: 'Actions',
    shortcut: 'd',
    screen: 'list',
    helpGroup: 'Actions',
    footer: true,
    footerLabel: 'delete',
    when: (ctx) => ctx.screen === 'list' && ctx.hasSelectedItem,
  },
  {
    id: 'open',
    label: 'Open in browser',
    category: 'Actions',
    shortcut: 'o',
    screen: 'list',
    helpGroup: 'Actions',
    when: (ctx) => ctx.screen === 'list' && ctx.hasSelectedItem,
  },
  {
    id: 'branch',
    label: 'Create branch/worktree',
    category: 'Actions',
    shortcut: 'b',
    screen: 'list',
    helpGroup: 'Other',
    when: (ctx) =>
      ctx.screen === 'list' && ctx.hasSelectedItem && ctx.gitAvailable,
  },
  {
    id: 'sync',
    label: 'Refresh/sync',
    category: 'Actions',
    shortcut: 'r',
    screen: 'list',
    helpGroup: 'Other',
    when: (ctx) => ctx.screen === 'list' && ctx.hasSyncManager,
  },
  {
    id: 'sort',
    label: 'Order by...',
    category: 'Actions',
    shortcut: 'O',
    screen: 'list',
    helpGroup: 'Actions',
    when: (ctx) => ctx.screen === 'list',
  },
  // Navigation
  {
    id: 'iterations',
    label: 'Go to iterations',
    category: 'Navigation',
    shortcut: 'i',
    screen: 'list',
    helpGroup: 'Switching',
    when: (ctx) => ctx.screen === 'list' && ctx.capabilities.iterations,
  },
  {
    id: 'settings',
    label: 'Go to settings',
    category: 'Navigation',
    shortcut: ',',
    screen: 'list',
    helpGroup: 'Switching',
    footer: true,
    footerLabel: 'settings',
    when: (ctx) => ctx.screen === 'list',
  },
  {
    id: 'status',
    label: 'Go to status',
    category: 'Navigation',
    shortcut: 's',
    screen: 'list',
    helpGroup: 'Actions',
    when: (ctx) => ctx.screen === 'list',
  },
  {
    id: 'help',
    label: 'Go to help',
    category: 'Navigation',
    shortcut: '?',
    screen: 'global',
    footer: true,
    footerLabel: 'help',
  },
  // Bulk
  {
    id: 'mark',
    label: 'Mark/unmark item',
    category: 'Bulk',
    shortcut: 'm',
    screen: 'list',
    helpGroup: 'Actions',
    when: (ctx) => ctx.screen === 'list' && ctx.hasSelectedItem,
  },
  {
    id: 'clear-marks',
    label: 'Clear all marks',
    category: 'Bulk',
    shortcut: 'M',
    screen: 'list',
    helpGroup: 'Bulk',
    when: (ctx) => ctx.screen === 'list' && ctx.markedCount > 0,
  },
  {
    id: 'set-priority',
    label: 'Set priority',
    category: 'Bulk',
    screen: 'list',
    helpGroup: 'Bulk',
    when: (ctx) =>
      ctx.screen === 'list' &&
      ctx.capabilities.fields.priority &&
      (ctx.hasSelectedItem || ctx.markedCount > 0),
  },
  {
    id: 'set-assignee',
    label: 'Set assignee',
    category: 'Bulk',
    shortcut: 'a',
    screen: 'list',
    helpGroup: 'Actions',
    when: (ctx) =>
      ctx.screen === 'list' &&
      ctx.capabilities.fields.assignee &&
      (ctx.hasSelectedItem || ctx.markedCount > 0),
  },
  {
    id: 'set-labels',
    label: 'Set labels',
    category: 'Bulk',
    shortcut: 'l',
    screen: 'list',
    helpGroup: 'Actions',
    when: (ctx) =>
      ctx.screen === 'list' &&
      ctx.capabilities.fields.labels &&
      (ctx.hasSelectedItem || ctx.markedCount > 0),
  },
  {
    id: 'set-type',
    label: 'Set type',
    category: 'Bulk',
    shortcut: 't',
    screen: 'list',
    helpGroup: 'Bulk',
    when: (ctx) =>
      ctx.screen === 'list' &&
      ctx.capabilities.customTypes &&
      (ctx.hasSelectedItem || ctx.markedCount > 0),
  },
  {
    id: 'bulk-menu',
    label: 'Bulk actions menu',
    category: 'Bulk',
    shortcut: 'B',
    screen: 'list',
    helpGroup: 'Bulk',
    when: (ctx) => ctx.screen === 'list' && ctx.markedCount > 0,
  },
  {
    id: 'filter',
    label: 'Filter...',
    category: 'Actions',
    shortcut: 'F',
    screen: 'list',
    helpGroup: 'Actions',
    when: (ctx) => ctx.screen === 'list',
  },
  {
    id: 'clear-filters',
    label: 'Clear filters',
    category: 'Actions',
    shortcut: 'X',
    screen: 'list',
    helpGroup: 'Actions',
    when: (ctx) => ctx.screen === 'list' && ctx.hasActiveFilters,
  },
  {
    id: 'load-view',
    label: 'Load view...',
    category: 'Actions',
    shortcut: 'V',
    screen: 'list',
    helpGroup: 'Actions',
    when: (ctx) => ctx.screen === 'list',
  },
  {
    id: 'save-view',
    label: 'Save current view...',
    category: 'Actions',
    screen: 'list',
    when: (ctx) => ctx.screen === 'list' && ctx.hasActiveFilters,
  },
  {
    id: 'delete-view',
    label: 'Delete view...',
    category: 'Actions',
    screen: 'list',
    when: (ctx) => ctx.screen === 'list' && ctx.hasSavedViews,
  },
  // List-screen navigation
  {
    id: 'list-navigate',
    label: 'Navigate items',
    category: 'Navigation',
    shortcut: '↑/↓',
    screen: 'list',
    helpGroup: 'Navigation',
    footer: true,
    footerLabel: 'navigate',
  },
  {
    id: 'list-page',
    label: 'Page up / page down',
    category: 'Navigation',
    shortcut: 'pgup/pgdn',
    screen: 'list',
    helpGroup: 'Navigation',
  },
  {
    id: 'list-home-end',
    label: 'Jump to first / last item',
    category: 'Navigation',
    shortcut: 'home/end',
    screen: 'list',
    helpGroup: 'Navigation',
  },
  {
    id: 'list-collapse',
    label: 'Collapse or jump to parent',
    category: 'Navigation',
    shortcut: '←',
    screen: 'list',
    helpGroup: 'Navigation',
    when: (ctx) => ctx.capabilities.relationships,
  },
  {
    id: 'list-expand',
    label: 'Expand children',
    category: 'Navigation',
    shortcut: '→',
    screen: 'list',
    helpGroup: 'Navigation',
    when: (ctx) => ctx.capabilities.relationships,
  },
  // List-screen actions missing from registry
  {
    id: 'list-undo',
    label: 'Undo last action',
    category: 'Actions',
    shortcut: 'u',
    screen: 'list',
    helpGroup: 'Actions',
    footer: true,
    footerLabel: 'undo',
  },
  {
    id: 'list-status',
    label: 'Set status',
    category: 'Actions',
    shortcut: 's',
    screen: 'list',
    helpGroup: 'Actions',
  },
  {
    id: 'list-parent',
    label: 'Set parent',
    category: 'Actions',
    shortcut: 'g',
    screen: 'list',
    helpGroup: 'Actions',
    when: (ctx) => ctx.capabilities.fields.parent,
  },
  {
    id: 'list-pr-create',
    label: 'Create pull request',
    category: 'Actions',
    shortcut: 'p',
    screen: 'list',
    helpGroup: 'Actions',
  },
  {
    id: 'list-pr-list',
    label: 'Pull requests',
    category: 'Navigation',
    shortcut: 'P',
    screen: 'list',
    helpGroup: 'Actions',
  },
  {
    id: 'list-branch-manage',
    label: 'Branch management',
    category: 'Navigation',
    shortcut: 'B',
    screen: 'list',
    helpGroup: 'Actions',
    when: (ctx) => ctx.gitAvailable,
  },
  {
    id: 'list-range-select',
    label: 'Range select',
    category: 'Bulk',
    shortcut: 'shift+↑↓',
    screen: 'list',
    helpGroup: 'Actions',
  },
  {
    id: 'list-bulk-actions',
    label: 'Bulk actions menu',
    category: 'Bulk',
    shortcut: 'x',
    screen: 'list',
    helpGroup: 'Actions',
  },
  {
    id: 'list-tab',
    label: 'Cycle work item type',
    category: 'Switching',
    shortcut: 'tab',
    screen: 'list',
    helpGroup: 'Switching',
    when: (ctx) => ctx.capabilities.customTypes,
  },
  {
    id: 'list-load-view',
    label: 'Load saved view',
    category: 'Switching',
    shortcut: 'V',
    screen: 'list',
    helpGroup: 'Switching',
  },
  {
    id: 'list-toggle-description',
    label: 'Toggle full description',
    category: 'Other',
    shortcut: 'space',
    screen: 'list',
    helpGroup: 'Other',
  },
  {
    id: 'list-command-bar',
    label: 'Command bar',
    category: 'Actions',
    shortcut: '/',
    screen: 'list',
    helpGroup: 'Actions',
    footer: true,
    footerLabel: 'commands',
  },
  // Navigation shared across sub-screens
  {
    id: 'nav-back',
    label: 'Back to list',
    category: 'Navigation',
    shortcut: 'esc',
    screen: ['pr-list', 'branch-list', 'iteration-picker'],
    helpGroup: 'Navigation',
    footer: true,
    footerLabel: 'back',
  },
  // Branch list actions
  {
    id: 'branch-navigate',
    label: 'Navigate branches',
    category: 'Navigation',
    shortcut: 'j/k',
    screen: 'branch-list',
    helpGroup: 'Navigation',
    footer: true,
    footerLabel: 'navigate',
  },
  {
    id: 'branch-search',
    label: 'Search branches',
    category: 'Actions',
    shortcut: '/',
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
    label: 'Merge into current',
    category: 'Actions',
    shortcut: 'm',
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
    label: 'Push to remote',
    category: 'Actions',
    shortcut: 'P',
    screen: 'branch-list',
    helpGroup: 'Actions',
    footer: true,
    footerLabel: 'push',
    when: (ctx) => ctx.screen === 'branch-list' && ctx.hasSelectedBranch,
  },
  {
    id: 'branch-create-pr',
    label: 'Create PR for branch',
    category: 'Actions',
    shortcut: 'p',
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
    screen: 'branch-list',
    helpGroup: 'Actions',
    footer: true,
    footerLabel: 'worktree',
    when: (ctx) =>
      ctx.screen === 'branch-list' && ctx.hasSelectedBranch && ctx.hasWorktree,
  },
  {
    id: 'branch-refresh',
    label: 'Refresh branches',
    category: 'Actions',
    shortcut: 'r',
    screen: 'branch-list',
    helpGroup: 'Actions',
    footer: true,
    footerLabel: 'refresh',
    when: (ctx) => ctx.screen === 'branch-list',
  },
  // PR list actions
  {
    id: 'pr-navigate',
    label: 'Navigate pull requests',
    category: 'Navigation',
    shortcut: 'j/k',
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
    screen: 'pr-list',
    helpGroup: 'Actions',
    footer: true,
    footerLabel: 'open',
    when: (ctx) => ctx.screen === 'pr-list' && ctx.hasSelectedPr,
  },
  {
    id: 'pr-search',
    label: 'Search pull requests',
    category: 'Actions',
    shortcut: '/',
    screen: 'pr-list',
    helpGroup: 'Actions',
    footer: true,
    footerLabel: 'search',
  },
  // Form commands
  {
    id: 'form-navigate',
    label: 'Move between fields',
    category: 'Navigation',
    shortcut: '↑/↓',
    screen: 'form',
    helpGroup: 'Navigation',
  },
  {
    id: 'form-edit',
    label: 'Edit field / open $EDITOR (description) / navigate to related item',
    category: 'Actions',
    shortcut: 'enter',
    screen: 'form',
    helpGroup: 'Editing',
  },
  {
    id: 'form-revert',
    label: 'Revert field to previous value (in edit mode)',
    category: 'Actions',
    shortcut: 'esc',
    screen: 'form',
    helpGroup: 'Editing',
  },
  {
    id: 'form-confirm',
    label: 'Confirm field value',
    category: 'Actions',
    shortcut: 'enter/select',
    screen: 'form',
    helpGroup: 'Editing',
  },
  {
    id: 'form-save',
    label: 'Save and go back',
    category: 'Actions',
    shortcut: 's',
    screen: 'form',
    helpGroup: 'Save & Exit',
  },
  {
    id: 'form-back',
    label: 'Go back (prompts to save/discard if unsaved changes)',
    category: 'Navigation',
    shortcut: 'esc',
    screen: 'form',
    helpGroup: 'Save & Exit',
  },
  // Iteration picker commands
  {
    id: 'iter-navigate',
    label: 'Navigate iterations',
    category: 'Navigation',
    shortcut: '↑/↓',
    screen: 'iteration-picker',
    helpGroup: 'Navigation',
  },
  {
    id: 'iter-select',
    label: 'Select iteration',
    category: 'Actions',
    shortcut: 'enter',
    screen: 'iteration-picker',
    helpGroup: 'Navigation',
  },
  // Settings commands
  {
    id: 'settings-navigate',
    label: 'Navigate options',
    category: 'Navigation',
    shortcut: '↑/↓',
    screen: 'settings',
    helpGroup: 'Navigation',
  },
  {
    id: 'settings-select',
    label: 'Select or edit',
    category: 'Actions',
    shortcut: 'enter',
    screen: 'settings',
    helpGroup: 'Navigation',
  },
  {
    id: 'settings-back',
    label: 'Go back',
    category: 'Navigation',
    shortcut: 'esc/,',
    screen: 'settings',
    helpGroup: 'Navigation',
  },
  {
    id: 'settings-edit',
    label: 'Edit field value',
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
    id: 'settings-create-template',
    label: 'Create template',
    category: 'Actions',
    shortcut: 'c',
    screen: 'settings',
    helpGroup: 'Templates',
    when: (ctx) => ctx.capabilities.templates,
  },
  {
    id: 'settings-delete-template',
    label: 'Delete template',
    category: 'Actions',
    shortcut: 'd',
    screen: 'settings',
    helpGroup: 'Templates',
    when: (ctx) => ctx.capabilities.templates,
  },
  {
    id: 'settings-edit-template',
    label: 'Edit template',
    category: 'Actions',
    shortcut: 'enter',
    screen: 'settings',
    helpGroup: 'Templates',
    when: (ctx) => ctx.capabilities.templates,
  },
  // Status screen commands
  {
    id: 'status-scroll',
    label: 'Scroll errors',
    category: 'Navigation',
    shortcut: '↑/↓',
    screen: 'status',
    helpGroup: 'Navigation',
  },
  {
    id: 'status-back',
    label: 'Go back',
    category: 'Navigation',
    shortcut: 'esc/q',
    screen: 'status',
    helpGroup: 'Navigation',
  },
  {
    id: 'status-retry',
    label: 'Retry failed sync operations',
    category: 'Actions',
    shortcut: 'r',
    screen: 'status',
    helpGroup: 'Actions',
    when: (ctx) => ctx.hasSyncManager,
  },
  // Other
  {
    id: 'toggle-detail-panel',
    label: 'Toggle detail panel',
    category: 'Other',
    shortcut: 'v',
    screen: 'list',
    helpGroup: 'Other',
    when: (ctx) => ctx.screen === 'list',
  },
  {
    id: 'quit',
    label: 'Quit',
    category: 'Other',
    shortcut: 'q',
    screen: 'global',
    helpGroup: 'Other',
    when: () => true,
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
  const sep = '  ';
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
