import type { WorkItem, NewWorkItem, NewComment, Comment } from '../types.js';

export interface Backend {
  getStatuses(): string[];
  getIterations(): string[];
  getWorkItemTypes(): string[];
  getCurrentIteration(): string;
  setCurrentIteration(name: string): void;
  listWorkItems(iteration?: string): WorkItem[];
  getWorkItem(id: number): WorkItem;
  createWorkItem(data: NewWorkItem): WorkItem;
  updateWorkItem(id: number, data: Partial<WorkItem>): WorkItem;
  deleteWorkItem(id: number): void;
  addComment(workItemId: number, comment: NewComment): Comment;
}
