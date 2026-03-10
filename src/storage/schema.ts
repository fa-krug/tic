import {
  sqliteTable,
  text,
  integer,
  index,
  primaryKey,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

// 1. Work Items
export const workItems = sqliteTable(
  'work_items',
  {
    rowId: integer('row_id').primaryKey({ autoIncrement: true }),
    id: text('id'),
    title: text('title').notNull(),
    type: text('type').notNull(),
    status: text('status').notNull(),
    iteration: text('iteration').notNull().default(''),
    priority: text('priority').notNull().default(''),
    assignee: text('assignee').notNull().default(''),
    description: text('description').notNull().default(''),
    parent: integer('parent'),
    created: text('created').notNull(),
    updated: text('updated').notNull(),
    deletedAt: text('deleted_at'),
  },
  (t) => [
    uniqueIndex('idx_display_id').on(t.id),
    index('idx_status').on(t.status),
    index('idx_type').on(t.type),
    index('idx_assignee').on(t.assignee),
    index('idx_priority').on(t.priority),
    index('idx_iteration').on(t.iteration),
    index('idx_parent').on(t.parent),
    index('idx_deleted_iteration').on(t.deletedAt, t.iteration),
    index('idx_deleted_status').on(t.deletedAt, t.status),
    index('idx_deleted_assignee').on(t.deletedAt, t.assignee),
  ],
);

// 2. Work Item Labels (junction)
export const workItemLabels = sqliteTable(
  'work_item_labels',
  {
    workItemRowId: integer('work_item_row_id')
      .notNull()
      .references(() => workItems.rowId, { onDelete: 'cascade' }),
    label: text('label').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.workItemRowId, t.label] }),
    index('idx_label').on(t.label),
  ],
);

// 3. Work Item Dependencies (junction)
export const workItemDeps = sqliteTable(
  'work_item_deps',
  {
    workItemRowId: integer('work_item_row_id')
      .notNull()
      .references(() => workItems.rowId, { onDelete: 'cascade' }),
    dependsOnRowId: integer('depends_on_row_id')
      .notNull()
      .references(() => workItems.rowId, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.workItemRowId, t.dependsOnRowId] }),
    index('idx_dep_target').on(t.dependsOnRowId),
  ],
);

// 4. Comments
export const comments = sqliteTable(
  'comments',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    workItemRowId: integer('work_item_row_id')
      .notNull()
      .references(() => workItems.rowId, { onDelete: 'cascade' }),
    author: text('author').notNull().default(''),
    body: text('body').notNull(),
    created: text('created').notNull(),
  },
  (t) => [index('idx_comment_item').on(t.workItemRowId)],
);

// 5. Templates
export const templates = sqliteTable('templates', {
  slug: text('slug').primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull().default(''),
  status: text('status').notNull().default(''),
  priority: text('priority').notNull().default(''),
  assignee: text('assignee').notNull().default(''),
  iteration: text('iteration').notNull().default(''),
  parent: text('parent'),
  description: text('description').notNull().default(''),
});

// 6. Template Labels (junction)
export const templateLabels = sqliteTable(
  'template_labels',
  {
    templateSlug: text('template_slug')
      .notNull()
      .references(() => templates.slug, { onDelete: 'cascade' }),
    label: text('label').notNull(),
  },
  (t) => [primaryKey({ columns: [t.templateSlug, t.label] })],
);

// 7. Template Dependencies (junction)
export const templateDeps = sqliteTable(
  'template_deps',
  {
    templateSlug: text('template_slug')
      .notNull()
      .references(() => templates.slug, { onDelete: 'cascade' }),
    dependsOnId: text('depends_on_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.templateSlug, t.dependsOnId] })],
);

// 8. Project Configuration (singleton, id=1)
export const projectConfig = sqliteTable('project_config', {
  id: integer('id').primaryKey().default(1),
  backend: text('backend').notNull().default('none'),
  currentIteration: text('current_iteration').notNull().default(''),
  branchMode: text('branch_mode').notNull().default('branch'),
  branchCommand: text('branch_command').notNull().default(''),
  copyToClipboard: integer('copy_to_clipboard', { mode: 'boolean' })
    .notNull()
    .default(true),
  autoUpdate: integer('auto_update', { mode: 'boolean' })
    .notNull()
    .default(true),
  defaultType: text('default_type').notNull().default('issue'),
  showDetailPanel: integer('show_detail_panel', { mode: 'boolean' })
    .notNull()
    .default(false),
  defaultView: text('default_view').notNull().default(''),
  theme: text('theme').notNull().default('default'),
});

// 9. Statuses
export const statuses = sqliteTable('statuses', {
  name: text('name').primaryKey(),
  sortOrder: integer('sort_order').notNull().default(0),
});

// 10. Work Item Types
export const workItemTypes = sqliteTable('work_item_types', {
  name: text('name').primaryKey(),
  sortOrder: integer('sort_order').notNull().default(0),
});

// 11. Iterations
export const iterations = sqliteTable('iterations', {
  name: text('name').primaryKey(),
  sortOrder: integer('sort_order').notNull().default(0),
  startDate: text('start_date'),
  endDate: text('end_date'),
});

// 12. Jira Configuration (singleton, id=1)
export const jiraConfig = sqliteTable('jira_config', {
  id: integer('id').primaryKey().default(1),
  site: text('site').notNull().default(''),
  project: text('project').notNull().default(''),
  boardId: text('board_id').notNull().default(''),
});

// 13. Saved Views
export const savedViews = sqliteTable('saved_views', {
  name: text('name').primaryKey(),
});

// 14. Saved View Filters
export const savedViewFilters = sqliteTable(
  'saved_view_filters',
  {
    viewName: text('view_name')
      .notNull()
      .references(() => savedViews.name, { onDelete: 'cascade' }),
    field: text('field').notNull(),
    value: text('value').notNull(),
  },
  (t) => [primaryKey({ columns: [t.viewName, t.field, t.value] })],
);

// 15. Saved View Sort Entries
export const savedViewSortEntries = sqliteTable(
  'saved_view_sort_entries',
  {
    viewName: text('view_name')
      .notNull()
      .references(() => savedViews.name, { onDelete: 'cascade' }),
    column: text('column').notNull(),
    direction: text('direction').notNull(),
    sortOrder: integer('sort_order').notNull(),
  },
  (t) => [primaryKey({ columns: [t.viewName, t.sortOrder] })],
);

// 16. Sync Queue
export const syncQueue = sqliteTable(
  'sync_queue',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    action: text('action').notNull(),
    itemRowId: integer('item_row_id').notNull(),
    timestamp: text('timestamp').notNull(),
    commentData: text('comment_data'),
    templateSlug: text('template_slug'),
  },
  (t) => [index('idx_queue_item').on(t.itemRowId, t.action)],
);

// 17. Undo Stack
export const undoStack = sqliteTable('undo_stack', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  action: text('action').notNull(),
  metadata: text('metadata').notNull(),
  createdAt: text('created_at').notNull(),
});

// 18. File Sync State
export const fileSyncState = sqliteTable('file_sync_state', {
  itemRowId: integer('item_row_id').primaryKey(),
  hash: text('hash').notNull(),
  syncedAt: text('synced_at').notNull(),
});

// 22. Color Mappings (user overrides for field colors)
export const colorMappings = sqliteTable(
  'color_mappings',
  {
    fieldType: text('field_type').notNull(),
    value: text('value').notNull(),
    bg: text('bg').notNull(),
    fg: text('fg').notNull(),
  },
  (t) => [primaryKey({ columns: [t.fieldType, t.value] })],
);

// 23. Pull Requests
export const pullRequests = sqliteTable(
  'pull_requests',
  {
    id: text('id').primaryKey(),
    number: integer('number').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    status: text('status').notNull(),
    sourceBranch: text('source_branch').notNull(),
    targetBranch: text('target_branch').notNull(),
    author: text('author').notNull().default(''),
    url: text('url').notNull().default(''),
    remoteId: text('remote_id'),
    created: text('created').notNull(),
    updated: text('updated').notNull(),
  },
  (t) => [
    index('idx_pr_status').on(t.status),
    index('idx_pr_remote').on(t.remoteId),
  ],
);

// 24. PR-Item Links (junction for bidirectional linking)
export const prItemLinks = sqliteTable(
  'pr_item_links',
  {
    prId: text('pr_id')
      .notNull()
      .references(() => pullRequests.id, { onDelete: 'cascade' }),
    itemRowId: integer('item_row_id')
      .notNull()
      .references(() => workItems.rowId, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.prId, t.itemRowId] }),
    index('idx_pr_link_item').on(t.itemRowId),
  ],
);
