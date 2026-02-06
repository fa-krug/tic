import type { BackendCapabilities } from './types.js';

const NO_TEMPLATE_FIELDS = {
  type: false,
  status: false,
  priority: false,
  assignee: false,
  labels: false,
  iteration: false,
  parent: false,
  dependsOn: false,
  description: false,
} as const;

/**
 * Static capability maps for remote backends.
 * Used by CLI to gate command options without instantiating backend classes.
 * Jira is excluded because its `iterations` capability depends on runtime config.
 */
export const BACKEND_CAPABILITIES: Partial<
  Record<string, BackendCapabilities>
> = {
  github: {
    relationships: true,
    customTypes: false,
    customStatuses: false,
    iterations: true,
    comments: true,
    fields: {
      priority: false,
      assignee: true,
      labels: true,
      parent: true,
      dependsOn: false,
    },
    templates: false,
    templateFields: { ...NO_TEMPLATE_FIELDS },
  },
  gitlab: {
    relationships: true,
    customTypes: false,
    customStatuses: false,
    iterations: true,
    comments: true,
    fields: {
      priority: false,
      assignee: true,
      labels: true,
      parent: true,
      dependsOn: false,
    },
    templates: true,
    templateFields: { ...NO_TEMPLATE_FIELDS, description: true },
  },
  azure: {
    relationships: true,
    customTypes: false,
    customStatuses: false,
    iterations: true,
    comments: true,
    fields: {
      priority: true,
      assignee: true,
      labels: true,
      parent: true,
      dependsOn: true,
    },
    templates: false,
    templateFields: { ...NO_TEMPLATE_FIELDS },
  },
};
