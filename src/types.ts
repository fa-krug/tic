export interface Comment {
  author: string;
  date: string;
  body: string;
}

export interface Issue {
  id: number;
  title: string;
  status: string;
  iteration: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  assignee: string;
  labels: string[];
  created: string;
  updated: string;
  description: string;
  comments: Comment[];
}

export type NewIssue = Pick<
  Issue,
  | 'title'
  | 'status'
  | 'iteration'
  | 'priority'
  | 'assignee'
  | 'labels'
  | 'description'
>;

export interface NewComment {
  author: string;
  body: string;
}
