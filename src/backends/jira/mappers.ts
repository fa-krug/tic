import type { WorkItem, Comment } from '../../types.js';

// ADF → plain text (minimal conversion for display)
export interface AdfNode {
  type: string;
  text?: string;
  content?: AdfNode[];
}

export function adfToText(adf: AdfNode | string | null | undefined): string {
  if (!adf) return '';
  if (typeof adf === 'string') return adf;

  const parts: string[] = [];
  if (adf.text) parts.push(adf.text);
  if (adf.content) {
    for (const child of adf.content) {
      parts.push(adfToText(child));
    }
  }
  return parts.join('');
}

export interface JiraIssue {
  key: string;
  fields: {
    summary: string;
    description: unknown;
    status: { name: string };
    issuetype: { name: string };
    priority: { name: string } | null;
    assignee: { displayName: string; emailAddress: string } | null;
    labels: string[];
    sprint: { name: string } | null;
    created: string;
    updated: string;
    parent: { key: string } | null;
    issuelinks: JiraIssueLink[] | undefined;
  };
}

export interface JiraIssueLink {
  type: { name: string; inward: string; outward: string };
  inwardIssue?: { key: string };
  outwardIssue?: { key: string };
}

export interface JiraComment {
  author: { displayName: string; emailAddress: string };
  created: string;
  body: unknown;
}

export interface JiraSprint {
  id: number;
  name: string;
  state: string;
  startDate?: string;
  endDate?: string;
}

export function mapPriorityToTic(
  priority: string | undefined,
): 'critical' | 'high' | 'medium' | 'low' {
  switch (priority) {
    case 'Highest':
    case 'Critical':
      return 'critical';
    case 'High':
      return 'high';
    case 'Medium':
      return 'medium';
    case 'Low':
    case 'Lowest':
      return 'low';
    default:
      return 'medium';
  }
}

export function mapPriorityToJira(priority: string): string {
  switch (priority) {
    case 'critical':
      return 'Highest';
    case 'high':
      return 'High';
    case 'medium':
      return 'Medium';
    case 'low':
      return 'Low';
    default:
      return 'Medium';
  }
}

export function extractDependsOn(links: JiraIssueLink[] | undefined): string[] {
  if (!links) return [];
  return links.flatMap((link) =>
    link.type.inward === 'is blocked by' && link.inwardIssue != null
      ? [link.inwardIssue.key]
      : [],
  );
}

export function mapIssueToWorkItem(issue: JiraIssue): WorkItem {
  return {
    id: issue.key,
    title: issue.fields.summary,
    description: adfToText(issue.fields.description as AdfNode | string | null),
    status: issue.fields.status.name.toLowerCase(),
    type: issue.fields.issuetype.name.toLowerCase(),
    priority: mapPriorityToTic(issue.fields.priority?.name),
    assignee: issue.fields.assignee?.emailAddress ?? '',
    labels: issue.fields.labels,
    iteration: issue.fields.sprint?.name ?? '',
    created: issue.fields.created,
    updated: issue.fields.updated,
    parent: issue.fields.parent?.key ?? null,
    dependsOn: extractDependsOn(issue.fields.issuelinks),
    comments: [],
  };
}

export function mapCommentToComment(comment: JiraComment): Comment {
  return {
    author: comment.author.emailAddress,
    date: comment.created,
    body: adfToText(comment.body as AdfNode | string | null),
  };
}
