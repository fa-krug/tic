import type { WorkItem, Comment } from '../../types.js';

export interface GhIssue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  assignees: { login: string }[];
  labels: { name: string }[];
  milestone: { title: string } | null;
  createdAt: string;
  updatedAt: string;
  comments?: GhComment[];
}

export interface GhComment {
  author: { login: string };
  createdAt: string;
  body: string;
}

export interface GhMilestone {
  title: string;
  state: string;
  due_on: string | null;
}

export function mapCommentToComment(ghComment: GhComment): Comment {
  return {
    author: ghComment.author.login,
    date: ghComment.createdAt,
    body: ghComment.body,
  };
}

export function mapIssueToWorkItem(ghIssue: GhIssue): WorkItem {
  return {
    id: String(ghIssue.number),
    title: ghIssue.title,
    description: ghIssue.body ?? '',
    status: ghIssue.state === 'OPEN' ? 'open' : 'closed',
    type: 'issue',
    assignee: ghIssue.assignees[0]?.login ?? '',
    labels: ghIssue.labels.map((l) => l.name),
    iteration: ghIssue.milestone?.title ?? '',
    priority: 'medium',
    created: ghIssue.createdAt,
    updated: ghIssue.updatedAt,
    parent: null,
    dependsOn: [],
    comments: (ghIssue.comments ?? []).map(mapCommentToComment),
  };
}
