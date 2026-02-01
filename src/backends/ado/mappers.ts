import TurndownService from 'turndown';
import type { WorkItem, Comment } from '../../types.js';

const turndown = new TurndownService();

export interface AdoWorkItem {
  id: number;
  fields: Record<string, unknown>;
  relations?: AdoRelation[];
}

export interface AdoRelation {
  rel: string;
  url: string;
  attributes: Record<string, unknown>;
}

export interface AdoComment {
  createdBy: { displayName: string };
  createdDate: string;
  text: string;
}

export interface AdoIteration {
  name: string;
  path: string;
  attributes: {
    startDate?: string;
    finishDate?: string;
  };
}

export interface AdoWorkItemType {
  name: string;
  states: { name: string }[];
}

export function mapPriorityToTic(
  priority: number | undefined,
): 'critical' | 'high' | 'medium' | 'low' {
  switch (priority) {
    case 1:
      return 'critical';
    case 2:
      return 'high';
    case 3:
      return 'medium';
    case 4:
      return 'low';
    default:
      return 'medium';
  }
}

export function mapPriorityToAdo(priority: string): number {
  switch (priority) {
    case 'critical':
      return 1;
    case 'high':
      return 2;
    case 'medium':
      return 3;
    case 'low':
      return 4;
    default:
      return 3;
  }
}

export function parseTags(tags: string | undefined): string[] {
  if (!tags) return [];
  return tags
    .split(';')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

export function formatTags(tags: string[]): string {
  return tags.join('; ');
}

function extractIdFromUrl(url: string): string {
  const match = url.match(/\/workItems\/(\d+)$/);
  return match ? match[1]! : '';
}

export function extractParent(
  relations: AdoRelation[] | undefined,
): string | null {
  if (!relations) return null;
  const parent = relations.find(
    (r) => r.rel === 'System.LinkTypes.Hierarchy-Reverse',
  );
  return parent ? extractIdFromUrl(parent.url) || null : null;
}

export function extractPredecessors(
  relations: AdoRelation[] | undefined,
): string[] {
  if (!relations) return [];
  return relations
    .filter((r) => r.rel === 'System.LinkTypes.Dependency-Reverse')
    .map((r) => extractIdFromUrl(r.url))
    .filter((id) => id !== '');
}

function htmlToMarkdown(html: string | undefined): string {
  if (!html) return '';
  return turndown.turndown(html);
}

export function mapWorkItemToWorkItem(ado: AdoWorkItem): WorkItem {
  const fields = ado.fields;
  const assignedTo = fields['System.AssignedTo'] as
    | { displayName: string }
    | undefined;

  return {
    id: String(ado.id),
    title: (fields['System.Title'] as string) ?? '',
    type: (fields['System.WorkItemType'] as string) ?? '',
    status: (fields['System.State'] as string) ?? '',
    iteration: (fields['System.IterationPath'] as string) ?? '',
    priority: mapPriorityToTic(
      fields['Microsoft.VSTS.Common.Priority'] as number | undefined,
    ),
    assignee: assignedTo?.displayName ?? '',
    labels: parseTags(fields['System.Tags'] as string | undefined),
    description: htmlToMarkdown(
      fields['System.Description'] as string | undefined,
    ),
    created: (fields['System.CreatedDate'] as string) ?? '',
    updated: (fields['System.ChangedDate'] as string) ?? '',
    parent: extractParent(ado.relations),
    dependsOn: extractPredecessors(ado.relations),
    comments: [],
  };
}

export function mapCommentToComment(ado: AdoComment): Comment {
  return {
    author: ado.createdBy.displayName,
    date: ado.createdDate,
    body: htmlToMarkdown(ado.text),
  };
}
