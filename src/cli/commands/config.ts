import { VALID_BACKENDS } from '../../backends/factory.js';
import { Storage } from '../../storage/index.js';
import {
  readConfig as readConfigFromDb,
  updateConfig,
} from '../../storage/config.js';

const READABLE_KEYS = [
  'backend',
  'current_iteration',
  'types',
  'statuses',
  'iterations',
  'next_id',
] as const;

type ConfigKey = (typeof READABLE_KEYS)[number];

function isValidKey(key: string): key is ConfigKey {
  return (READABLE_KEYS as readonly string[]).includes(key);
}

// eslint-disable-next-line @typescript-eslint/require-await
export async function runConfigGet(
  root: string,
  key: string,
): Promise<unknown> {
  if (!isValidKey(key)) {
    throw new Error(
      `Unknown config key "${key}". Valid keys: ${READABLE_KEYS.join(', ')}`,
    );
  }
  const storage = Storage.create(root);
  try {
    const config = readConfigFromDb(storage.getDatabase());
    return config[key];
  } finally {
    storage.destroy();
  }
}

// eslint-disable-next-line @typescript-eslint/require-await
export async function runConfigSet(
  root: string,
  key: string,
  value: string,
): Promise<void> {
  if (!isValidKey(key)) {
    throw new Error(
      `Unknown config key "${key}". Valid keys: ${READABLE_KEYS.join(', ')}`,
    );
  }

  const storage = Storage.create(root);
  try {
    if (key === 'backend') {
      if (!(VALID_BACKENDS as readonly string[]).includes(value)) {
        throw new Error(
          `Invalid backend "${value}". Valid backends: ${VALID_BACKENDS.join(', ')}`,
        );
      }
      updateConfig(storage.getDatabase(), { backend: value });
    } else if (key === 'current_iteration') {
      updateConfig(storage.getDatabase(), { current_iteration: value });
    } else {
      throw new Error(`Config key "${key}" is read-only`);
    }
  } finally {
    storage.destroy();
  }
}
