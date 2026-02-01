import { describe, it, expect } from 'vitest';
import type { WorkItem, NewWorkItem, NewComment, Comment } from '../types.js';
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
};

/* eslint-disable @typescript-eslint/no-unused-vars */
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
  getStatuses(): string[] {
    return [];
  }
  getIterations(): string[] {
    return [];
  }
  getWorkItemTypes(): string[] {
    return [];
  }
  getAssignees(): string[] {
    return [];
  }
  getCurrentIteration(): string {
    return '';
  }
  setCurrentIteration(_name: string): void {}
  listWorkItems(_iteration?: string): WorkItem[] {
    return [];
  }
  getWorkItem(_id: string): WorkItem {
    throw new Error('not implemented');
  }
  createWorkItem(_data: NewWorkItem): WorkItem {
    throw new Error('not implemented');
  }
  updateWorkItem(_id: string, _data: Partial<WorkItem>): WorkItem {
    throw new Error('not implemented');
  }
  deleteWorkItem(_id: string): void {}
  addComment(_workItemId: string, _comment: NewComment): Comment {
    throw new Error('not implemented');
  }
  getChildren(_id: string): WorkItem[] {
    return [];
  }
  getDependents(_id: string): WorkItem[] {
    return [];
  }
  getItemUrl(_id: string): string {
    return '';
  }
  openItem(_id: string): void {}
}
/* eslint-enable @typescript-eslint/no-unused-vars */

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
