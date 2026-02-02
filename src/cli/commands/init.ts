import fs from 'node:fs';
import path from 'node:path';
import { writeConfig, defaultConfig } from '../../backends/local/config.js';

interface InitResult {
  success: boolean;
  alreadyExists: boolean;
}

export async function runInit(
  root: string,
  backend?: string,
): Promise<InitResult> {
  const configPath = path.join(root, '.tic', 'config.yml');
  if (fs.existsSync(configPath)) {
    return { success: true, alreadyExists: true };
  }
  await writeConfig(root, { ...defaultConfig, backend: backend ?? 'local' });
  return { success: true, alreadyExists: false };
}
