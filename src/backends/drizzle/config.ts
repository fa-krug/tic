import { eq } from 'drizzle-orm';
import type { Config } from '../local/config.js';
import type { TicDatabase, TicTransaction } from './db.js';
import * as schema from './schema.js';

/**
 * Read the full Config from the SQLite database.
 */
export function readConfig(db: TicDatabase): Config {
  // 1. Read projectConfig singleton (id=1)
  const pc = db
    .select()
    .from(schema.projectConfig)
    .where(eq(schema.projectConfig.id, 1))
    .get();

  // 2. Read ordered arrays
  const statusRows = db
    .select()
    .from(schema.statuses)
    .orderBy(schema.statuses.sortOrder)
    .all();
  const typeRows = db
    .select()
    .from(schema.workItemTypes)
    .orderBy(schema.workItemTypes.sortOrder)
    .all();
  const iterationRows = db
    .select()
    .from(schema.iterations)
    .orderBy(schema.iterations.sortOrder)
    .all();

  // 3. Read jiraConfig singleton
  const jc = db
    .select()
    .from(schema.jiraConfig)
    .where(eq(schema.jiraConfig.id, 1))
    .get();

  // 4. Read saved views with filters and sort entries
  const viewRows = db.select().from(schema.savedViews).all();
  const filterRows = db.select().from(schema.savedViewFilters).all();
  const sortRows = db
    .select()
    .from(schema.savedViewSortEntries)
    .orderBy(schema.savedViewSortEntries.sortOrder)
    .all();

  // Build the config object
  const config: Config = {
    backend: pc?.backend ?? 'drizzle',
    statuses: statusRows.map((r) => r.name),
    types: typeRows.map((r) => r.name),
    current_iteration: pc?.currentIteration ?? '',
    iterations: iterationRows.map((r) => r.name),
    next_id: pc?.nextId ?? 1,
    branchMode: (pc?.branchMode as 'worktree' | 'branch') ?? 'worktree',
    autoUpdate: pc?.autoUpdate ?? true,
  };

  // Optional fields — only include when they have non-default values
  if (pc?.defaultType && pc.defaultType !== '') {
    config.defaultType = pc.defaultType;
  }

  if (pc?.showDetailPanel === true) {
    config.showDetailPanel = true;
  }

  if (pc?.branchCommand && pc.branchCommand !== '') {
    config.branchCommand = pc.branchCommand;
  }

  if (pc?.copyToClipboard !== undefined) {
    config.copyToClipboard = pc.copyToClipboard;
  }

  if (pc?.defaultView && pc.defaultView !== '') {
    config.defaultView = pc.defaultView;
  }

  // Jira — only include if site is non-empty
  if (jc && jc.site !== '') {
    const jira: Config['jira'] = {
      site: jc.site,
      project: jc.project,
    };
    if (jc.boardId !== '') {
      jira.boardId = Number(jc.boardId);
    }
    config.jira = jira;
  }

  // Views — only include if there are any
  if (viewRows.length > 0) {
    // Group filters by view name and field
    const filtersByView = new Map<string, Map<string, string[]>>();
    for (const f of filterRows) {
      let viewFilters = filtersByView.get(f.viewName);
      if (!viewFilters) {
        viewFilters = new Map();
        filtersByView.set(f.viewName, viewFilters);
      }
      let fieldValues = viewFilters.get(f.field);
      if (!fieldValues) {
        fieldValues = [];
        viewFilters.set(f.field, fieldValues);
      }
      fieldValues.push(f.value);
    }

    // Group sort entries by view name
    const sortByView = new Map<
      string,
      Array<{ column: string; direction: string }>
    >();
    for (const s of sortRows) {
      let viewSort = sortByView.get(s.viewName);
      if (!viewSort) {
        viewSort = [];
        sortByView.set(s.viewName, viewSort);
      }
      viewSort.push({ column: s.column, direction: s.direction });
    }

    config.views = viewRows.map((v) => {
      const viewFilters = filtersByView.get(v.name);
      const filters: Record<string, string[]> = {};
      if (viewFilters) {
        for (const [field, values] of viewFilters) {
          filters[field] = values;
        }
      }

      const result: NonNullable<Config['views']>[number] = {
        name: v.name,
        filters,
      };

      const viewSort = sortByView.get(v.name);
      if (viewSort && viewSort.length > 0) {
        result.sort = viewSort;
      }

      return result;
    });
  }

  return config;
}

/**
 * Insert (or replace) the full Config into the database tables using
 * the given transaction handle.  Shared by `writeConfig` and the legacy
 * migration so the insertion logic is defined in exactly one place.
 */
export function insertConfigTx(tx: TicTransaction, config: Config): void {
  // 1. Upsert projectConfig singleton
  tx.insert(schema.projectConfig)
    .values({
      id: 1,
      backend: config.backend,
      currentIteration: config.current_iteration,
      nextId: config.next_id,
      branchMode: config.branchMode,
      branchCommand: config.branchCommand ?? '',
      copyToClipboard: config.copyToClipboard ?? true,
      autoUpdate: config.autoUpdate,
      defaultType: config.defaultType ?? '',
      showDetailPanel: config.showDetailPanel ?? false,
      defaultView: config.defaultView ?? '',
    })
    .onConflictDoUpdate({
      target: schema.projectConfig.id,
      set: {
        backend: config.backend,
        currentIteration: config.current_iteration,
        nextId: config.next_id,
        branchMode: config.branchMode,
        branchCommand: config.branchCommand ?? '',
        copyToClipboard: config.copyToClipboard ?? true,
        autoUpdate: config.autoUpdate,
        defaultType: config.defaultType ?? '',
        showDetailPanel: config.showDetailPanel ?? false,
        defaultView: config.defaultView ?? '',
      },
    })
    .run();

  // 2. Replace statuses
  tx.delete(schema.statuses).run();
  for (let i = 0; i < config.statuses.length; i++) {
    tx.insert(schema.statuses)
      .values({ name: config.statuses[i]!, sortOrder: i })
      .run();
  }

  // 3. Replace types
  tx.delete(schema.workItemTypes).run();
  for (let i = 0; i < config.types.length; i++) {
    tx.insert(schema.workItemTypes)
      .values({ name: config.types[i]!, sortOrder: i })
      .run();
  }

  // 4. Replace iterations
  tx.delete(schema.iterations).run();
  for (let i = 0; i < config.iterations.length; i++) {
    tx.insert(schema.iterations)
      .values({ name: config.iterations[i]!, sortOrder: i })
      .run();
  }

  // 5. Upsert jiraConfig
  if (config.jira) {
    tx.insert(schema.jiraConfig)
      .values({
        id: 1,
        site: config.jira.site,
        project: config.jira.project,
        boardId:
          config.jira.boardId !== undefined ? String(config.jira.boardId) : '',
      })
      .onConflictDoUpdate({
        target: schema.jiraConfig.id,
        set: {
          site: config.jira.site,
          project: config.jira.project,
          boardId:
            config.jira.boardId !== undefined
              ? String(config.jira.boardId)
              : '',
        },
      })
      .run();
  } else {
    // Clear jira config by setting to empty values
    tx.insert(schema.jiraConfig)
      .values({ id: 1, site: '', project: '', boardId: '' })
      .onConflictDoUpdate({
        target: schema.jiraConfig.id,
        set: { site: '', project: '', boardId: '' },
      })
      .run();
  }

  // 6. Replace saved views (cascade deletes filters and sort entries)
  tx.delete(schema.savedViews).run();

  if (config.views && config.views.length > 0) {
    for (const view of config.views) {
      tx.insert(schema.savedViews).values({ name: view.name }).run();

      // Insert filters
      const filters = view.filters;
      if (filters) {
        for (const [field, values] of Object.entries(filters)) {
          if (values && values.length > 0) {
            for (const value of values) {
              tx.insert(schema.savedViewFilters)
                .values({ viewName: view.name, field, value })
                .run();
            }
          }
        }
      }

      // Insert sort entries
      if (view.sort && view.sort.length > 0) {
        for (let i = 0; i < view.sort.length; i++) {
          const s = view.sort[i]!;
          tx.insert(schema.savedViewSortEntries)
            .values({
              viewName: view.name,
              column: s.column,
              direction: s.direction,
              sortOrder: i,
            })
            .run();
        }
      }
    }
  }
}

/**
 * Write the full Config to the SQLite database, replacing all existing data.
 * Uses a transaction to keep tables consistent.
 */
export function writeConfig(db: TicDatabase, config: Config): void {
  db.transaction((tx) => {
    insertConfigTx(tx, config);
  });
}

/**
 * Read the current config, merge partial updates over it, and write back.
 */
export function updateConfig(db: TicDatabase, partial: Partial<Config>): void {
  const current = readConfig(db);
  const merged = { ...current, ...partial };
  writeConfig(db, merged);
}
