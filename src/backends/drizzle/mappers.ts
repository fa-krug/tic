import type { WorkItem, Comment, Template } from '../../types.js';
import type {
  workItems,
  workItemLabels,
  workItemDeps,
  comments,
  templates,
  templateLabels,
  templateDeps,
} from './schema.js';

/** Row type from the work_items table */
export type WorkItemRow = typeof workItems.$inferSelect;

/** Row type from the work_item_labels table */
export type WorkItemLabelRow = typeof workItemLabels.$inferSelect;

/** Row type from the work_item_deps table */
export type WorkItemDepRow = typeof workItemDeps.$inferSelect;

/** Row type from the comments table */
export type CommentRow = typeof comments.$inferSelect;

/** Row type from the templates table */
export type TemplateRow = typeof templates.$inferSelect;

/** Row type from the template_labels table */
export type TemplateLabelRow = typeof templateLabels.$inferSelect;

/** Row type from the template_deps table */
export type TemplateDepRow = typeof templateDeps.$inferSelect;

/** Insertable row for work_items (without auto-derived fields) */
export type WorkItemInsert = typeof workItems.$inferInsert;

/**
 * Assemble a WorkItem from a DB row plus related junction rows.
 */
export function rowToWorkItem(
  row: WorkItemRow,
  labels: WorkItemLabelRow[],
  deps: WorkItemDepRow[],
  itemComments: CommentRow[],
): WorkItem {
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    status: row.status,
    iteration: row.iteration,
    priority: (row.priority || 'medium') as WorkItem['priority'],
    assignee: row.assignee,
    labels: labels.map((l) => l.label),
    created: row.created,
    updated: row.updated,
    description: row.description,
    comments: itemComments.map(rowToComment),
    parent: row.parent,
    dependsOn: deps.map((d) => d.dependsOnId),
  };
}

/**
 * Convert a WorkItem to an insertable work_items row.
 * Labels, deps, and comments go into their own junction tables.
 */
export function workItemToRow(item: WorkItem): WorkItemInsert {
  return {
    id: item.id,
    title: item.title,
    type: item.type,
    status: item.status,
    iteration: item.iteration,
    priority: item.priority,
    assignee: item.assignee,
    description: item.description,
    parent: item.parent,
    created: item.created,
    updated: item.updated,
    deletedAt: null,
  };
}

/**
 * Assemble a Comment from a DB row.
 */
export function rowToComment(row: CommentRow): Comment {
  return {
    author: row.author,
    date: row.created,
    body: row.body,
  };
}

/**
 * Assemble a Template from a DB row plus related junction rows.
 */
export function rowToTemplate(
  row: TemplateRow,
  labels: TemplateLabelRow[],
  deps: TemplateDepRow[],
): Template {
  return {
    slug: row.slug,
    name: row.name,
    type: row.type || undefined,
    status: row.status || undefined,
    priority: (row.priority || undefined) as Template['priority'],
    assignee: row.assignee || undefined,
    labels: labels.length > 0 ? labels.map((l) => l.label) : undefined,
    iteration: row.iteration || undefined,
    parent: row.parent,
    dependsOn: deps.length > 0 ? deps.map((d) => d.dependsOnId) : undefined,
    description: row.description || undefined,
  };
}
