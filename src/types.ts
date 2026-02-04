export interface Comment {
  author: string;
  date: string;
  body: string;
}

export interface WorkItem {
  id: string;
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
  parent: string | null;
  dependsOn: string[];
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
