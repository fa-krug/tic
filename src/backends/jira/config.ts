import { readConfig } from '../local/config.js';

export interface JiraConfig {
  site: string;
  project: string;
  boardId?: number;
}

export async function readJiraConfig(root: string): Promise<JiraConfig> {
  const config = await readConfig(root);
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
