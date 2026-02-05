import { configStore } from '../../stores/configStore.js';
import { readConfig } from '../local/config.js';

export interface JiraConfig {
  site: string;
  project: string;
  boardId?: number;
}

export async function readJiraConfig(root: string): Promise<JiraConfig> {
  // Use config store if loaded (TUI), fall back to disk read (CLI/MCP)
  const config = configStore.getState().loaded
    ? configStore.getState().config
    : await readConfig(root);
  if (!config.jira) {
    throw new Error(
      'Jira backend requires "jira" configuration in .tic/config.yml',
    );
  }
  if (!config.jira.site) {
    throw new Error('Jira backend requires "jira.site" in .tic/config.yml');
  }
  if (!config.jira.project) {
    throw new Error('Jira backend requires "jira.project" in .tic/config.yml');
  }
  return config.jira;
}
