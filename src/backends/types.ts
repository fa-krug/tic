import type { Issue, NewIssue, NewComment, Comment } from '../types.js';

export interface Backend {
  getStatuses(): string[];
  getIterations(): string[];
  getCurrentIteration(): string;
  setCurrentIteration(name: string): void;
  listIssues(iteration?: string): Issue[];
  getIssue(id: number): Issue;
  createIssue(data: NewIssue): Issue;
  updateIssue(id: number, data: Partial<Issue>): Issue;
  deleteIssue(id: number): void;
  addComment(issueId: number, comment: NewComment): Comment;
}
