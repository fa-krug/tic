import { describe, it, expect } from 'vitest';
import type {
  WorkItem,
  NewWorkItem,
  NewComment,
  Comment,
  Template,
} from '../types.js';
import {
  BaseBackend,
  UnsupportedOperationError,
  type BackendCapabilities,
} from './types.js';

const ALL_DISABLED: BackendCapabilities = {
  relationships: false,
  customTypes: false,
  customStatuses: false,
  iterations: false,
  comments: false,
  fields: {
    priority: false,
    assignee: false,
    labels: false,
    parent: false,
    dependsOn: false,
  },
  templates: false,
  templateFields: {
    type: false,
    status: false,
    priority: false,
    assignee: false,
    labels: false,
    iteration: false,
    parent: false,
    dependsOn: false,
    description: false,
  },
};

const ALL_ENABLED: BackendCapabilities = {
  relationships: true,
  customTypes: true,
  customStatuses: true,
  iterations: true,
  comments: true,
  fields: {
    priority: true,
    assignee: true,
    labels: true,
    parent: true,
    dependsOn: true,
  },
  templates: true,
  templateFields: {
    type: true,
    status: true,
    priority: true,
    assignee: true,
    labels: true,
    iteration: true,
    parent: true,
    dependsOn: true,
    description: true,
  },
};

/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/require-await */
class TestBackend extends BaseBackend {
  caps: BackendCapabilities;

  constructor(caps: BackendCapabilities) {
    super();
    this.caps = caps;
  }

  getCapabilities(): BackendCapabilities {
    return this.caps;
  }

  // Public wrappers for protected methods
  testValidateFields(data: Partial<NewWorkItem>): void {
    this.validateFields(data);
  }

  testAssertSupported(capability: boolean, operation: string): void {
    this.assertSupported(capability, operation);
  }

  // Abstract method stubs (not under test)
  async getStatuses(): Promise<string[]> {
    return [];
  }
  async getIterations(): Promise<string[]> {
    return [];
  }
  async getWorkItemTypes(): Promise<string[]> {
    return [];
  }
  async getAssignees(): Promise<string[]> {
    return [];
  }
  async getLabels(): Promise<string[]> {
    return [];
  }
  async getCurrentIteration(): Promise<string> {
    return '';
  }
  async setCurrentIteration(_name: string): Promise<void> {}
  async listWorkItems(_iteration?: string): Promise<WorkItem[]> {
    return [];
  }
  async getWorkItem(_id: string): Promise<WorkItem> {
    throw new Error('not implemented');
  }
  async createWorkItem(_data: NewWorkItem): Promise<WorkItem> {
    throw new Error('not implemented');
  }
  async updateWorkItem(
    _id: string,
    _data: Partial<WorkItem>,
  ): Promise<WorkItem> {
    throw new Error('not implemented');
  }
  async deleteWorkItem(_id: string): Promise<void> {}
  async addComment(
    _workItemId: string,
    _comment: NewComment,
  ): Promise<Comment> {
    throw new Error('not implemented');
  }
  override async getChildren(_id: string): Promise<WorkItem[]> {
    return [];
  }
  override async getDependents(_id: string): Promise<WorkItem[]> {
    return [];
  }
  getItemUrl(_id: string): string {
    return '';
  }
  async openItem(_id: string): Promise<void> {}
  async listTemplates(): Promise<Template[]> {
    return [];
  }
  async getTemplate(_slug: string): Promise<Template> {
    throw new Error('not implemented');
  }
  async createTemplate(_template: Template): Promise<Template> {
    throw new Error('not implemented');
  }
  async updateTemplate(
    _oldSlug: string,
    _template: Template,
  ): Promise<Template> {
    throw new Error('not implemented');
  }
  async deleteTemplate(_slug: string): Promise<void> {}
}
/* eslint-enable @typescript-eslint/no-unused-vars, @typescript-eslint/require-await */

describe('BaseBackend', () => {
  describe('validateFields', () => {
    describe('when capabilities are disabled', () => {
      const backend = new TestBackend(ALL_DISABLED);

      it('throws for unsupported priority with non-medium, non-undefined value', () => {
        expect(() => backend.testValidateFields({ priority: 'high' })).toThrow(
          UnsupportedOperationError,
        );
        expect(() => backend.testValidateFields({ priority: 'low' })).toThrow(
          UnsupportedOperationError,
        );
        expect(() =>
          backend.testValidateFields({ priority: 'critical' }),
        ).toThrow(UnsupportedOperationError);
      });

      it('throws for unsupported parent with non-null value', () => {
        expect(() => backend.testValidateFields({ parent: '1' })).toThrow(
          UnsupportedOperationError,
        );
        expect(() => backend.testValidateFields({ parent: '42' })).toThrow(
          UnsupportedOperationError,
        );
      });

      it('throws for unsupported dependsOn with non-empty array', () => {
        expect(() => backend.testValidateFields({ dependsOn: ['1'] })).toThrow(
          UnsupportedOperationError,
        );
        expect(() =>
          backend.testValidateFields({ dependsOn: ['1', '2', '3'] }),
        ).toThrow(UnsupportedOperationError);
      });

      it('throws for unsupported assignee with non-empty string', () => {
        expect(() => backend.testValidateFields({ assignee: 'alice' })).toThrow(
          UnsupportedOperationError,
        );
      });

      it('throws for unsupported labels with non-empty array', () => {
        expect(() => backend.testValidateFields({ labels: ['bug'] })).toThrow(
          UnsupportedOperationError,
        );
        expect(() =>
          backend.testValidateFields({ labels: ['bug', 'feature'] }),
        ).toThrow(UnsupportedOperationError);
      });

      it('does not throw when unsupported fields have default/empty values', () => {
        expect(() =>
          backend.testValidateFields({ priority: undefined }),
        ).not.toThrow();
        expect(() =>
          backend.testValidateFields({ priority: 'medium' }),
        ).not.toThrow();
        expect(() =>
          backend.testValidateFields({ assignee: '' }),
        ).not.toThrow();
        expect(() => backend.testValidateFields({ labels: [] })).not.toThrow();
        expect(() =>
          backend.testValidateFields({ parent: null }),
        ).not.toThrow();
        expect(() =>
          backend.testValidateFields({ dependsOn: [] }),
        ).not.toThrow();
      });

      it('does not throw for an empty data object', () => {
        expect(() => backend.testValidateFields({})).not.toThrow();
      });
    });

    describe('when all capabilities are enabled', () => {
      const backend = new TestBackend(ALL_ENABLED);

      it('does not throw for any field values', () => {
        expect(() =>
          backend.testValidateFields({
            priority: 'critical',
            assignee: 'alice',
            labels: ['bug', 'feature'],
            parent: '5',
            dependsOn: ['1', '2'],
          }),
        ).not.toThrow();
      });
    });
  });

  describe('assertSupported', () => {
    const backend = new TestBackend(ALL_DISABLED);

    it('throws UnsupportedOperationError when capability is false', () => {
      expect(() => backend.testAssertSupported(false, 'iterations')).toThrow(
        UnsupportedOperationError,
      );
      expect(() => backend.testAssertSupported(false, 'iterations')).toThrow(
        /iterations is not supported by the TestBackend backend/,
      );
    });

    it('does not throw when capability is true', () => {
      expect(() =>
        backend.testAssertSupported(true, 'iterations'),
      ).not.toThrow();
    });
  });
});
