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
    when: (ctx) =>
      ctx.screen === 'list' ||
      ctx.screen === 'branch-list' ||
      ctx.screen === 'pr-list',
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
  // Branch list actions
  {
    id: 'branch-switch',
    label: 'Switch to branch',
    category: 'Actions',
    shortcut: 'enter',
    screen: 'branch-list',
    helpGroup: 'Actions',
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
    when: (ctx) => ctx.screen === 'branch-list',
  },
  {
    id: 'branch-delete',
    label: 'Delete branch',
    category: 'Actions',
    shortcut: 'd',
    screen: 'branch-list',
    helpGroup: 'Actions',
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
    when: (ctx) => ctx.screen === 'branch-list',
  },
  {
    id: 'branch-back',
    label: 'Back to items',
    category: 'Navigation',
    shortcut: 'esc',
    screen: 'branch-list',
    helpGroup: 'Navigation',
    when: (ctx) => ctx.screen === 'branch-list',
  },
  // PR list actions
  {
    id: 'pr-open',
    label: 'Open in browser',
    category: 'Actions',
    shortcut: 'enter',
    screen: 'pr-list',
    helpGroup: 'Actions',
    when: (ctx) => ctx.screen === 'pr-list' && ctx.hasSelectedPr,
  },
  {
    id: 'pr-back',
    label: 'Back to items',
    category: 'Navigation',
    shortcut: 'esc',
    screen: 'pr-list',
    helpGroup: 'Navigation',
    when: (ctx) => ctx.screen === 'pr-list',
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
