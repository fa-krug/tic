import Database from 'better-sqlite3';
import {
  drizzle,
  type BetterSQLite3Database,
} from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import fs from 'node:fs';
import path from 'node:path';
import * as schema from './schema.js';

export type TicDatabase = BetterSQLite3Database<typeof schema> & {
  close(): void;
  /** Access raw better-sqlite3 instance when needed */
  raw: Database.Database;
};

export function createDatabase(root: string): TicDatabase {
  const isMemory = root === ':memory:';
  let dbPath: string;

  if (isMemory) {
    dbPath = ':memory:';
  } else {
    const ticDir = path.join(root, '.tic');
    fs.mkdirSync(ticDir, { recursive: true });
    dbPath = path.join(ticDir, 'tic.db');
  }

  const sqlite = new Database(dbPath);

  // Enable WAL mode for concurrent access (TUI + MCP + CLI)
  if (!isMemory) {
    sqlite.pragma('journal_mode = WAL');
  }

  // Enable foreign key constraints
  sqlite.pragma('foreign_keys = ON');

  const db = drizzle(sqlite, { schema });

  // Apply migrations
  const migrationsFolder = path.join(import.meta.dirname, '../../../drizzle');
  migrate(db, { migrationsFolder });

  const ticDb = db as unknown as TicDatabase;
  ticDb.close = () => sqlite.close();
  ticDb.raw = sqlite;

  return ticDb;
}
