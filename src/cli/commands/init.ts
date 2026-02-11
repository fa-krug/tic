import fs from 'node:fs';
import path from 'node:path';
import { Storage } from '../../storage/index.js';
import { updateConfig } from '../../storage/config.js';

interface InitResult {
  success: boolean;
  alreadyExists: boolean;
}

// eslint-disable-next-line @typescript-eslint/require-await
export async function runInit(
  root: string,
  backend?: string,
): Promise<InitResult> {
  const dbPath = path.join(root, '.tic', 'tic.db');
  const configPath = path.join(root, '.tic', 'config.yml');
  if (fs.existsSync(dbPath) || fs.existsSync(configPath)) {
    return { success: true, alreadyExists: true };
  }
  const storage = Storage.create(root);
  if (backend) {
    updateConfig(storage.getDatabase(), { backend });
  }
  storage.destroy();
  return { success: true, alreadyExists: false };
}
