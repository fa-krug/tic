#!/usr/bin/env node
import module from 'node:module';
module.enableCompileCache?.();

import fs from 'node:fs';
import path from 'node:path';

if (process.argv.length > 2) {
  const { runCli } = await import('./cli/index.js');
  await runCli(process.argv);
} else {
  // Lazy-load Ink/React only for TUI mode
  const { render } = await import('ink');
  const { App } = await import('./app.js');
  const { ErrorBoundary } = await import('./components/ErrorBoundary.js');
  const { configStore } = await import('./stores/configStore.js');
  const { backendDataStore } = await import('./stores/backendDataStore.js');
  const { undoStore } = await import('./stores/undoStore.js');
  const { recentCommandsStore } =
    await import('./stores/recentCommandsStore.js');
  const { isSoftDeleteBackend } = await import('./backends/types.js');
  const { initThemeFromConfig } = await import('./stores/themeStore.js');

  const cwd = process.cwd();

  // Auto-init on first run: detect backend from git remotes
  const dbPath = path.join(cwd, '.tic', 'tic.db');
  if (!fs.existsSync(dbPath)) {
    const { detectBackend } = await import('./backends/factory.js');
    const { runInit } = await import('./cli/commands/init.js');
    await runInit(cwd, detectBackend(cwd));
  }

  await configStore.getState().init(cwd);
  initThemeFromConfig();

  // Init is non-blocking - UI renders immediately with loading state
  backendDataStore.getState().init(cwd);

  await recentCommandsStore.getState().init(cwd);

  console.clear();
  const app = render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>,
  );
  await app.waitUntilExit();

  // Clean up undo stack — permanently delete any remaining soft-deleted items
  const backend = backendDataStore.getState().backend;
  if (backend && isSoftDeleteBackend(backend)) {
    const remaining = undoStore.getState().clear();
    for (const entry of remaining) {
      if (entry.type === 'delete') {
        for (const snap of entry.itemSnapshots) {
          await backend.permanentlyDeleteWorkItem(snap.id);
        }
      }
    }
    await backend.cleanupTrash();
  }

  recentCommandsStore.getState().destroy();
  backendDataStore.getState().destroy();
  configStore.getState().destroy();

  // If an update was requested from Settings, run it now
  const { isUpdateRequested, runUpdate } = await import('./updater.js');
  if (isUpdateRequested()) {
    runUpdate([]);
  }
}
