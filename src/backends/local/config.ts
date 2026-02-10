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
  autoUpdate: boolean;
  defaultType?: string;
  showDetailPanel?: boolean;
  branchCommand?: string;
  copyToClipboard?: boolean;
  jira?: {
    site: string;
    project: string;
    boardId?: number;
  };
  views?: Array<{
    name: string;
    filters: {
      statuses?: string[];
      types?: string[];
      priorities?: string[];
      assignees?: string[];
      labels?: string[];
    };
    sort?: Array<{ column: string; direction: string }>;
  }>;
}

export const defaultConfig: Config = {
  backend: 'local',
  types: ['epic', 'issue', 'task'],
  statuses: ['backlog', 'todo', 'in-progress', 'review', 'done'],
  current_iteration: 'default',
  iterations: ['default'],
  next_id: 1,
  branchMode: 'worktree',
  autoUpdate: true,
  branchCommand: `bash --init-file <(echo "source ~/.bashrc; claude 'Brainstorm the implementation of issue #$TIC_ITEM_ID: $TIC_ITEM_TITLE. $TIC_ITEM_DESCRIPTION'")`,
  copyToClipboard: true,
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
