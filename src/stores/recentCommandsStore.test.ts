import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { recentCommandsStore } from './recentCommandsStore.js';

describe('recentCommandsStore', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'tic-recent-'));
    await mkdir(join(root, '.tic'), { recursive: true });
  });

  afterEach(() => {
    recentCommandsStore.getState().destroy();
  });

  it('starts with empty recentIds', () => {
    expect(recentCommandsStore.getState().recentIds).toEqual([]);
  });

  it('init reads from disk', async () => {
    await writeFile(
      join(root, '.tic', 'recent-commands.json'),
      JSON.stringify(['create', 'edit', 'sync']),
    );

    await recentCommandsStore.getState().init(root);

    expect(recentCommandsStore.getState().recentIds).toEqual([
      'create',
      'edit',
      'sync',
    ]);
  });

  it('init handles missing file', async () => {
    await recentCommandsStore.getState().init(root);

    expect(recentCommandsStore.getState().recentIds).toEqual([]);
  });

  it('init handles corrupted JSON', async () => {
    await writeFile(
      join(root, '.tic', 'recent-commands.json'),
      'not valid json{{{',
    );

    await recentCommandsStore.getState().init(root);

    expect(recentCommandsStore.getState().recentIds).toEqual([]);
  });

  it('init handles non-array JSON', async () => {
    await writeFile(
      join(root, '.tic', 'recent-commands.json'),
      JSON.stringify({ foo: 'bar' }),
    );

    await recentCommandsStore.getState().init(root);

    expect(recentCommandsStore.getState().recentIds).toEqual([]);
  });

  it('init filters non-string values', async () => {
    await writeFile(
      join(root, '.tic', 'recent-commands.json'),
      JSON.stringify(['create', 42, null, 'edit']),
    );

    await recentCommandsStore.getState().init(root);

    expect(recentCommandsStore.getState().recentIds).toEqual([
      'create',
      'edit',
    ]);
  });

  it('init truncates to max 5', async () => {
    await writeFile(
      join(root, '.tic', 'recent-commands.json'),
      JSON.stringify(['a', 'b', 'c', 'd', 'e', 'f', 'g']),
    );

    await recentCommandsStore.getState().init(root);

    expect(recentCommandsStore.getState().recentIds).toHaveLength(5);
  });

  it('addRecent prepends new command', async () => {
    await recentCommandsStore.getState().init(root);

    recentCommandsStore.getState().addRecent('create');
    recentCommandsStore.getState().addRecent('edit');

    expect(recentCommandsStore.getState().recentIds).toEqual([
      'edit',
      'create',
    ]);
  });

  it('addRecent deduplicates by moving to front', async () => {
    await recentCommandsStore.getState().init(root);

    recentCommandsStore.getState().addRecent('create');
    recentCommandsStore.getState().addRecent('edit');
    recentCommandsStore.getState().addRecent('sync');
    recentCommandsStore.getState().addRecent('create');

    expect(recentCommandsStore.getState().recentIds).toEqual([
      'create',
      'sync',
      'edit',
    ]);
  });

  it('addRecent trims to 5', async () => {
    await recentCommandsStore.getState().init(root);

    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) {
      recentCommandsStore.getState().addRecent(id);
    }

    const { recentIds } = recentCommandsStore.getState();
    expect(recentIds).toHaveLength(5);
    expect(recentIds[0]).toBe('f');
    expect(recentIds[4]).toBe('b');
  });

  it('addRecent writes to disk', async () => {
    await recentCommandsStore.getState().init(root);

    recentCommandsStore.getState().addRecent('create');
    recentCommandsStore.getState().addRecent('edit');

    // Wait for async write
    await new Promise((r) => setTimeout(r, 100));

    const data = await readFile(
      join(root, '.tic', 'recent-commands.json'),
      'utf-8',
    );
    expect(JSON.parse(data)).toEqual(['edit', 'create']);
  });

  it('destroy resets state', async () => {
    await recentCommandsStore.getState().init(root);
    recentCommandsStore.getState().addRecent('create');

    recentCommandsStore.getState().destroy();

    expect(recentCommandsStore.getState().recentIds).toEqual([]);
    expect(recentCommandsStore.getState().root).toBeNull();
  });

  it('recovers from write errors and continues writing', async () => {
    const { rm } = await import('node:fs/promises');
    await recentCommandsStore.getState().init(root);

    // Make the target file a directory so writeFile fails with EISDIR
    const filePath = join(root, '.tic', 'recent-commands.json');
    await rm(filePath, { force: true });
    await mkdir(filePath, { recursive: true });

    // First addRecent will fail because the path is a directory
    recentCommandsStore.getState().addRecent('create');

    // Wait for the failed write to settle
    await new Promise((r) => setTimeout(r, 100));

    // Fix the path: remove the directory so the next write succeeds
    await rm(filePath, { recursive: true });

    // Second addRecent should succeed because .catch(() => {}) prevents chain breakage
    recentCommandsStore.getState().addRecent('edit');

    // Wait for async write
    await new Promise((r) => setTimeout(r, 200));

    const data = await readFile(filePath, 'utf-8');
    expect(JSON.parse(data)).toEqual(['edit', 'create']);
  });
});
