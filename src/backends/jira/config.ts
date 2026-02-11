import { configStore } from '../../stores/configStore.js';

export interface JiraConfig {
  site: string;
  project: string;
  boardId?: number;
}

// eslint-disable-next-line @typescript-eslint/require-await, @typescript-eslint/no-unused-vars
export async function readJiraConfig(_root: string): Promise<JiraConfig> {
  const config = configStore.getState().config;
  if (!config.jira) {
    throw new Error(
      'Jira backend requires "jira" configuration. Set it via the Settings screen or "tic config".',
    );
  }
  if (!config.jira.site) {
    throw new Error(
      'Jira backend requires "jira.site". Set it via the Settings screen or "tic config".',
    );
  }
  if (!config.jira.project) {
    throw new Error(
      'Jira backend requires "jira.project". Set it via the Settings screen or "tic config".',
    );
  }
  return config.jira;
}
