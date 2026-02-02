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
  getStatuses(): Promise<string[]>;
  getIterations(): Promise<string[]>;
  getWorkItemTypes(): Promise<string[]>;
  getAssignees(): Promise<string[]>;
  getCurrentIteration(): Promise<string>;
  setCurrentIteration(name: string): Promise<void>;
  listWorkItems(iteration?: string): Promise<WorkItem[]>;
  getWorkItem(id: string): Promise<WorkItem>;
  createWorkItem(data: NewWorkItem): Promise<WorkItem>;
  updateWorkItem(id: string, data: Partial<WorkItem>): Promise<WorkItem>;
  deleteWorkItem(id: string): Promise<void>;
  addComment(workItemId: string, comment: NewComment): Promise<Comment>;
  getChildren(id: string): Promise<WorkItem[]>;
  getDependents(id: string): Promise<WorkItem[]>;
  getItemUrl(id: string): string;
  openItem(id: string): Promise<void>;
}

export abstract class BaseBackend implements Backend {
  abstract getCapabilities(): BackendCapabilities;
  abstract getStatuses(): Promise<string[]>;
  abstract getIterations(): Promise<string[]>;
  abstract getWorkItemTypes(): Promise<string[]>;
  abstract getAssignees(): Promise<string[]>;
  abstract getCurrentIteration(): Promise<string>;
  abstract setCurrentIteration(name: string): Promise<void>;
  abstract listWorkItems(iteration?: string): Promise<WorkItem[]>;
  abstract getWorkItem(id: string): Promise<WorkItem>;
  abstract createWorkItem(data: NewWorkItem): Promise<WorkItem>;
  abstract updateWorkItem(
    id: string,
    data: Partial<WorkItem>,
  ): Promise<WorkItem>;
  abstract deleteWorkItem(id: string): Promise<void>;
  abstract addComment(
    workItemId: string,
    comment: NewComment,
  ): Promise<Comment>;
  abstract getChildren(id: string): Promise<WorkItem[]>;
  abstract getDependents(id: string): Promise<WorkItem[]>;
  abstract getItemUrl(id: string): string;
  abstract openItem(id: string): Promise<void>;

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
