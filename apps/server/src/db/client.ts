import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.ts';

export const DEFAULT_DB_PATH = fileURLToPath(new URL('../../../../data/app.db', import.meta.url));
const MIGRATIONS_DIR = fileURLToPath(new URL('../../drizzle', import.meta.url));

export function openDb(path: string = process.env.LCE_DB_PATH ?? DEFAULT_DB_PATH) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return Object.assign(db, { close: () => sqlite.close() });
}

export type Db = ReturnType<typeof openDb>;
