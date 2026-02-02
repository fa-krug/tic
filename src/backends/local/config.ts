import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';

export interface Config {
  backend: string;
  types: string[];
  statuses: string[];
  current_iteration: string;
  iterations: string[];
  next_id: number;
  branchMode: 'worktree' | 'branch';
  jira?: {
    site: string;
    project: string;
    boardId?: number;
  };
}

export const defaultConfig: Config = {
  backend: 'local',
  types: ['epic', 'issue', 'task'],
  statuses: ['backlog', 'todo', 'in-progress', 'review', 'done'],
  current_iteration: 'default',
  iterations: ['default'],
  next_id: 1,
  branchMode: 'worktree',
};

function configPath(root: string): string {
  return path.join(root, '.tic', 'config.yml');
}

export async function readConfig(root: string): Promise<Config> {
  const p = configPath(root);
  try {
    const raw = await fs.readFile(p, 'utf-8');
    return yaml.parse(raw) as Config;
  } catch {
    return { ...defaultConfig };
  }
}

export function readConfigSync(root: string): Config {
  const p = configPath(root);
  if (!fsSync.existsSync(p)) return { ...defaultConfig };
  const raw = fsSync.readFileSync(p, 'utf-8');
  return yaml.parse(raw) as Config;
}

export async function writeConfig(root: string, config: Config): Promise<void> {
  const dir = path.join(root, '.tic');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(configPath(root), yaml.stringify(config));
}
