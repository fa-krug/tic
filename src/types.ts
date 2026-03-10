export interface Comment {
  author: string;
  date: string;
  body: string;
}

export interface WorkItem {
  rowId: number;
  id: string | null;
  title: string;
  type: string;
  status: string;
  iteration: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  assignee: string;
  labels: string[];
  created: string;
  updated: string;
  description: string;
  comments: Comment[];
  parent: number | null;
  dependsOn: number[];
}

export type NewWorkItem = Pick<
  WorkItem,
  | 'title'
  | 'type'
  | 'status'
  | 'iteration'
  | 'priority'
  | 'assignee'
  | 'labels'
  | 'description'
  | 'parent'
  | 'dependsOn'
>;

export interface NewComment {
  author: string;
  body: string;
}

export interface Template {
  slug: string;
  name: string;
  type?: string;
  status?: string;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  assignee?: string;
  labels?: string[];
  iteration?: string;
  parent?: string | null;
  dependsOn?: string[];
  description?: string;
}

export type PullRequestStatus = 'open' | 'merged' | 'closed' | 'draft';

export interface PullRequest {
  id: string;
  number: number;
  title: string;
  description: string;
  status: PullRequestStatus;
  sourceBranch: string;
  targetBranch: string;
  author: string;
  linkedItems: number[];
  created: string;
  updated: string;
  url: string;
}

export interface NewPullRequest {
  title: string;
  description?: string;
  sourceBranch: string;
  targetBranch?: string;
  linkedItems?: number[];
}

export interface Iteration {
  name: string;
  startDate: string | null;
  endDate: string | null;
}
