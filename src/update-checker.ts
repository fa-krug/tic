import semver from 'semver';
import { VERSION } from './version.js';

export interface UpdateInfo {
  current: string;
  latest: string;
  updateAvailable: boolean;
}

const REGISTRY_URL = 'https://registry.npmjs.org/@sascha384/tic/latest';
const TIMEOUT_MS = 5000;

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(REGISTRY_URL, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) return null;

    const data = (await response.json()) as Record<string, unknown>;
    const latest = data['version'];
    if (typeof latest !== 'string') return null;

    return {
      current: VERSION,
      latest,
      updateAvailable: semver.gt(latest, VERSION),
    };
  } catch {
    return null;
  }
}
