import type { WorkItem, Comment } from '../../types.js';

export interface GlIssue {
  iid: number;
  title: string;
  description: string | null;
  state: string;
  assignees: { username: string }[];
  labels: string[];
  milestone: { title: string } | null;
  epic: { iid: number } | null;
  created_at: string;
  updated_at: string;
}

export interface GlEpic {
  iid: number;
  title: string;
  description: string | null;
  state: string;
  labels: string[];
  created_at: string;
  updated_at: string;
}

export interface GlNote {
  author: { username: string };
  created_at: string;
  body: string;
}

export interface GlIteration {
  title: string;
  start_date: string;
  due_date: string;
}

export function mapIssueToWorkItem(issue: GlIssue): WorkItem {
  return {
    id: `issue-${issue.iid}`,
    title: issue.title,
    description: issue.description ?? '',
    status: issue.state === 'opened' ? 'open' : 'closed',
    type: 'issue',
    assignee: issue.assignees[0]?.username ?? '',
    labels: issue.labels,
    iteration: issue.milestone?.title ?? '',
    priority: 'medium',
    created: issue.created_at,
    updated: issue.updated_at,
    parent: issue.epic ? `epic-${issue.epic.iid}` : null,
    dependsOn: [],
    comments: [],
  };
}

export function mapEpicToWorkItem(epic: GlEpic): WorkItem {
  return {
    id: `epic-${epic.iid}`,
    title: epic.title,
    description: epic.description ?? '',
    status: epic.state === 'opened' ? 'open' : 'closed',
    type: 'epic',
    assignee: '',
    labels: epic.labels,
    iteration: '',
    priority: 'medium',
    created: epic.created_at,
    updated: epic.updated_at,
    parent: null,
    dependsOn: [],
    comments: [],
  };
}

export function mapNoteToComment(note: GlNote): Comment {
  return {
    author: note.author.username,
    date: note.created_at,
    body: note.body,
  };
}
