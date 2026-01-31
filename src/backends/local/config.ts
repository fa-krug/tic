import fs from 'node:fs';
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

export function readConfig(root: string): Config {
  const p = configPath(root);
  if (!fs.existsSync(p)) return { ...defaultConfig };
  const raw = fs.readFileSync(p, 'utf-8');
  return yaml.parse(raw) as Config;
}

export function writeConfig(root: string, config: Config): void {
  const dir = path.join(root, '.tic');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath(root), yaml.stringify(config));
}
