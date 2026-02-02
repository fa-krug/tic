import { readConfig, writeConfig } from '../../backends/local/config.js';
import { VALID_BACKENDS } from '../../backends/factory.js';

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

export async function runConfigGet(
  root: string,
  key: string,
): Promise<unknown> {
  if (!isValidKey(key)) {
    throw new Error(
      `Unknown config key "${key}". Valid keys: ${READABLE_KEYS.join(', ')}`,
    );
  }
  const config = await readConfig(root);
  return config[key];
}

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
  const config = await readConfig(root);

  if (key === 'backend') {
    if (!(VALID_BACKENDS as readonly string[]).includes(value)) {
      throw new Error(
        `Invalid backend "${value}". Valid backends: ${VALID_BACKENDS.join(', ')}`,
      );
    }
    config.backend = value;
  } else if (key === 'current_iteration') {
    config.current_iteration = value;
  } else {
    throw new Error(`Config key "${key}" is read-only`);
  }

  await writeConfig(root, config);
}
