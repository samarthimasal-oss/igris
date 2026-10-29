import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Thin, explicit SQLite connection. All data lives in one local database.
 * The schema is versioned with PRAGMA user_version so upgrades are predictable.
 */
export class Database {
  readonly raw: DatabaseSync

  constructor(filename: string) {
    if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true })
    this.raw = new DatabaseSync(filename)
    this.raw.exec('PRAGMA journal_mode = WAL;')
    this.raw.exec('PRAGMA foreign_keys = ON;')
    this.raw.exec('PRAGMA busy_timeout = 5000;')
    this.migrate()
  }

  private migrate(): void {
    const version = Number(
      (this.raw.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined)
        ?.user_version ?? 0
    )
    if (version >= 1) return

    this.raw.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS providers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        base_url TEXT NOT NULL,
        api_key_enc BLOB,
        key_hint TEXT,
        default_model TEXT NOT NULL DEFAULT '',
        supports_tools INTEGER NOT NULL DEFAULT 1,
        is_default INTEGER NOT NULL DEFAULT 0,
        last_test TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        meta TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        error TEXT,
        result TEXT,
        conversation_id TEXT,
        run_id TEXT,
        input TEXT,
        cancel_requested INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at DESC);

      CREATE TABLE IF NOT EXISTS task_steps (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        step_index INTEGER NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        detail TEXT,
        created_at TEXT NOT NULL,
        finished_at TEXT
      );

      CREATE TABLE IF NOT EXISTS tool_runs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        tool_name TEXT NOT NULL,
        status TEXT NOT NULL,
        approval TEXT NOT NULL DEFAULT 'not_required',
        args_json TEXT NOT NULL,
        result TEXT,
        error TEXT,
        started_at TEXT,
        finished_at TEXT
      );

      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        last_opened_at TEXT,
        kind TEXT
      );

      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        kind TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        level TEXT NOT NULL,
        scope TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_logs_created ON logs(created_at DESC);
    `)

    this.raw.exec('PRAGMA user_version = 1;')
  }

  close(): void {
    this.raw.close()
  }

  bytes(): number {
    try {
      const pageCount = Number(
        (this.raw.prepare('PRAGMA page_count').get() as { page_count?: number } | undefined)
          ?.page_count ?? 0
      )
      const pageSize = Number(
        (this.raw.prepare('PRAGMA page_size').get() as { page_size?: number } | undefined)
          ?.page_size ?? 0
      )
      return pageCount * pageSize
    } catch {
      return 0
    }
  }
}
