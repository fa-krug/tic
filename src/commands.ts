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
}

export interface Command {
  id: string;
  label: string;
  category: CommandCategory;
  shortcut?: string;
  when: (ctx: CommandContext) => boolean;
}

const commands: Command[] = [
  // Actions
  {
    id: 'create',
    label: 'Create item',
    category: 'Actions',
    shortcut: 'c',
    when: (ctx) => ctx.screen === 'list',
  },
  {
    id: 'edit',
    label: 'Edit item',
    category: 'Actions',
    shortcut: 'enter',
    when: (ctx) => ctx.screen === 'list' && ctx.hasSelectedItem,
  },
  {
    id: 'delete',
    label: 'Delete item',
    category: 'Actions',
    shortcut: 'd',
    when: (ctx) => ctx.screen === 'list' && ctx.hasSelectedItem,
  },
  {
    id: 'open',
    label: 'Open in browser',
    category: 'Actions',
    shortcut: 'o',
    when: (ctx) => ctx.screen === 'list' && ctx.hasSelectedItem,
  },
  {
    id: 'branch',
    label: 'Create branch/worktree',
    category: 'Actions',
    shortcut: 'b',
    when: (ctx) =>
      ctx.screen === 'list' && ctx.hasSelectedItem && ctx.gitAvailable,
  },
  {
    id: 'sync',
    label: 'Refresh/sync',
    category: 'Actions',
    shortcut: 'r',
    when: (ctx) => ctx.screen === 'list' && ctx.hasSyncManager,
  },
  {
    id: 'sort',
    label: 'Order by...',
    category: 'Actions',
    shortcut: 'O',
    when: (ctx) => ctx.screen === 'list',
  },
  // Navigation
  {
    id: 'iterations',
    label: 'Go to iterations',
    category: 'Navigation',
    shortcut: 'i',
    when: (ctx) => ctx.screen === 'list' && ctx.capabilities.iterations,
  },
  {
    id: 'settings',
    label: 'Go to settings',
    category: 'Navigation',
    shortcut: ',',
    when: (ctx) => ctx.screen === 'list',
  },
  {
    id: 'status',
    label: 'Go to status',
    category: 'Navigation',
    shortcut: 's',
    when: (ctx) => ctx.screen === 'list',
  },
  {
    id: 'help',
    label: 'Go to help',
    category: 'Navigation',
    shortcut: '?',
    when: (ctx) => ctx.screen === 'list',
  },
  // Bulk
  {
    id: 'mark',
    label: 'Mark/unmark item',
    category: 'Bulk',
    shortcut: 'm',
    when: (ctx) => ctx.screen === 'list' && ctx.hasSelectedItem,
  },
  {
    id: 'clear-marks',
    label: 'Clear all marks',
    category: 'Bulk',
    shortcut: 'M',
    when: (ctx) => ctx.screen === 'list' && ctx.markedCount > 0,
  },
  {
    id: 'set-priority',
    label: 'Set priority',
    category: 'Bulk',
    shortcut: 'P',
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
    when: (ctx) => ctx.screen === 'list' && ctx.markedCount > 0,
  },
  {
    id: 'filter',
    label: 'Filter...',
    category: 'Actions',
    shortcut: 'F',
    when: (ctx) => ctx.screen === 'list',
  },
  {
    id: 'clear-filters',
    label: 'Clear filters',
    category: 'Actions',
    shortcut: 'X',
    when: (ctx) => ctx.screen === 'list' && ctx.hasActiveFilters,
  },
  {
    id: 'load-view',
    label: 'Load view...',
    category: 'Actions',
    shortcut: 'V',
    when: (ctx) => ctx.screen === 'list',
  },
  {
    id: 'save-view',
    label: 'Save current view...',
    category: 'Actions',
    when: (ctx) => ctx.screen === 'list' && ctx.hasActiveFilters,
  },
  {
    id: 'delete-view',
    label: 'Delete view...',
    category: 'Actions',
    when: (ctx) => ctx.screen === 'list' && ctx.hasSavedViews,
  },
  // Other
  {
    id: 'toggle-detail-panel',
    label: 'Toggle detail panel',
    category: 'Other',
    shortcut: 'v',
    when: (ctx) => ctx.screen === 'list',
  },
  {
    id: 'quit',
    label: 'Quit',
    category: 'Other',
    shortcut: 'q',
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
  const visible = commands.filter((cmd) => cmd.when(ctx));

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
        when: () => true,
      });
    }
  }

  return visible;
}
