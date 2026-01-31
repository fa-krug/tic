import type { WorkItem, NewWorkItem, NewComment, Comment } from '../types.js';

export interface BackendCapabilities {
  relationships: boolean;
  customTypes: boolean;
  customStatuses: boolean;
  iterations: boolean;
  comments: boolean;
  fields: {
    priority: boolean;
    assignee: boolean;
    labels: boolean;
    parent: boolean;
    dependsOn: boolean;
  };
}

export class UnsupportedOperationError extends Error {
  constructor(operation: string, backend: string) {
    super(`${operation} is not supported by the ${backend} backend`);
    this.name = 'UnsupportedOperationError';
  }
}

export interface Backend {
  getCapabilities(): BackendCapabilities;
  getStatuses(): string[];
  getIterations(): string[];
  getWorkItemTypes(): string[];
  getCurrentIteration(): string;
  setCurrentIteration(name: string): void;
  listWorkItems(iteration?: string): WorkItem[];
  getWorkItem(id: string): WorkItem;
  createWorkItem(data: NewWorkItem): WorkItem;
  updateWorkItem(id: string, data: Partial<WorkItem>): WorkItem;
  deleteWorkItem(id: string): void;
  addComment(workItemId: string, comment: NewComment): Comment;
  getChildren(id: string): WorkItem[];
  getDependents(id: string): WorkItem[];
  getItemUrl(id: string): string;
  openItem(id: string): void;
}

export abstract class BaseBackend implements Backend {
  abstract getCapabilities(): BackendCapabilities;
  abstract getStatuses(): string[];
  abstract getIterations(): string[];
  abstract getWorkItemTypes(): string[];
  abstract getCurrentIteration(): string;
  abstract setCurrentIteration(name: string): void;
  abstract listWorkItems(iteration?: string): WorkItem[];
  abstract getWorkItem(id: string): WorkItem;
  abstract createWorkItem(data: NewWorkItem): WorkItem;
  abstract updateWorkItem(id: string, data: Partial<WorkItem>): WorkItem;
  abstract deleteWorkItem(id: string): void;
  abstract addComment(workItemId: string, comment: NewComment): Comment;
  abstract getChildren(id: string): WorkItem[];
  abstract getDependents(id: string): WorkItem[];
  abstract getItemUrl(id: string): string;
  abstract openItem(id: string): void;

  protected validateFields(data: Partial<NewWorkItem>): void {
    const caps = this.getCapabilities();
    const backendName = this.constructor.name;

    if (
      !caps.fields.priority &&
      data.priority !== undefined &&
      data.priority !== 'medium'
    ) {
      throw new UnsupportedOperationError('priority', backendName);
    }
    if (!caps.fields.assignee && data.assignee && data.assignee !== '') {
      throw new UnsupportedOperationError('assignee', backendName);
    }
    if (!caps.fields.labels && data.labels && data.labels.length > 0) {
      throw new UnsupportedOperationError('labels', backendName);
    }
    if (
      !caps.fields.parent &&
      data.parent !== undefined &&
      data.parent !== null
    ) {
      throw new UnsupportedOperationError('parent', backendName);
    }
    if (
      !caps.fields.dependsOn &&
      data.dependsOn !== undefined &&
      data.dependsOn.length > 0
    ) {
      throw new UnsupportedOperationError('dependsOn', backendName);
    }
  }

  protected assertSupported(capability: boolean, operation: string): void {
    if (!capability) {
      throw new UnsupportedOperationError(operation, this.constructor.name);
    }
  }
}
