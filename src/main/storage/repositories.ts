import { randomUUID } from 'node:crypto'
import type { Database } from './database'
import type {
  ChatMessage,
  ChatRole,
  Conversation,
  ConversationSummary,
  FileHit,
  LogEntry,
  MemoryItem,
  MessageMeta,
  ProviderKind,
  ProviderTestResult,
  Task,
  TaskDetail,
  TaskStatus,
  TaskStep,
  ToolRun,
  Workspace
} from '@shared/types'

type Row = Record<string, unknown>

export interface ProviderRow {
  id: string
  name: string
  kind: ProviderKind
  baseUrl: string
  apiKeyEnc: Uint8Array | null
  keyHint: string | null
  defaultModel: string
  supportsTools: boolean
  isDefault: boolean
  lastTest: ProviderTestResult | null
  createdAt: string
  updatedAt: string
}

function str(row: Row, key: string, fallback = ''): string {
  const value = row[key]
  return typeof value === 'string' ? value : fallback
}

function nullableStr(row: Row, key: string): string | null {
  const value = row[key]
  return typeof value === 'string' ? value : null
}

function num(row: Row, key: string): number {
  return Number(row[key] ?? 0)
}

function bool(row: Row, key: string): boolean {
  return Number(row[key] ?? 0) === 1
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function transaction(db: Database, fn: () => void): void {
  db.raw.exec('BEGIN IMMEDIATE')
  try {
    fn()
    db.raw.exec('COMMIT')
  } catch (error) {
    try {
      db.raw.exec('ROLLBACK')
    } catch {
      // The original failure is more useful than a rollback failure.
    }
    throw error
  }
}

export class SettingsRepository {
  constructor(private readonly db: Database) {}

  get(): unknown {
    const row = this.db.raw.prepare('SELECT value FROM settings WHERE key = ?').get('settings') as
      | Row
      | undefined
    if (!row) return null
    return parseJson<unknown>(row.value, null)
  }

  save(value: unknown): void {
    this.db.raw
      .prepare(
        `INSERT INTO settings (key, value) VALUES ('settings', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(JSON.stringify(value))
  }
}

export class ProviderRepository {
  constructor(private readonly db: Database) {}

  list(): ProviderRow[] {
    const rows = this.db.raw
      .prepare('SELECT * FROM providers ORDER BY is_default DESC, created_at ASC')
      .all() as Row[]
    return rows.map(mapProvider)
  }

  get(id: string): ProviderRow | null {
    const row = this.db.raw.prepare('SELECT * FROM providers WHERE id = ?').get(id) as Row | undefined
    return row ? mapProvider(row) : null
  }

  getDefault(): ProviderRow | null {
    const row = this.db.raw
      .prepare('SELECT * FROM providers WHERE is_default = 1 LIMIT 1')
      .get() as Row | undefined
    return row ? mapProvider(row) : null
  }

  save(provider: ProviderRow): void {
    transaction(this.db, () => {
      if (provider.isDefault) {
        this.db.raw.prepare('UPDATE providers SET is_default = 0').run()
      }
      this.db.raw
        .prepare(
          `INSERT INTO providers
            (id, name, kind, base_url, api_key_enc, key_hint, default_model, supports_tools, is_default, last_test, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             kind = excluded.kind,
             base_url = excluded.base_url,
             api_key_enc = excluded.api_key_enc,
             key_hint = excluded.key_hint,
             default_model = excluded.default_model,
             supports_tools = excluded.supports_tools,
             is_default = excluded.is_default,
             last_test = excluded.last_test,
             updated_at = excluded.updated_at`
        )
        .run(
          provider.id,
          provider.name,
          provider.kind,
          provider.baseUrl,
          provider.apiKeyEnc,
          provider.keyHint,
          provider.defaultModel,
          provider.supportsTools ? 1 : 0,
          provider.isDefault ? 1 : 0,
          provider.lastTest ? JSON.stringify(provider.lastTest) : null,
          provider.createdAt,
          provider.updatedAt
        )
    })
  }

  patch(id: string, patch: Partial<Pick<ProviderRow, 'defaultModel' | 'lastTest' | 'name' | 'baseUrl' | 'supportsTools'>>): void {
    const provider = this.get(id)
    if (!provider) throw new Error('Provider not found.')
    this.save({
      ...provider,
      ...patch,
      updatedAt: new Date().toISOString()
    })
  }

  remove(id: string): void {
    this.db.raw.prepare('DELETE FROM providers WHERE id = ?').run(id)
  }

  setDefault(id: string): void {
    transaction(this.db, () => {
      this.db.raw.prepare('UPDATE providers SET is_default = 0').run()
      this.db.raw.prepare('UPDATE providers SET is_default = 1 WHERE id = ?').run(id)
    })
  }

  count(): number {
    const row = this.db.raw.prepare('SELECT COUNT(*) AS n FROM providers').get() as Row
    return num(row, 'n')
  }
}

function mapProvider(row: Row): ProviderRow {
  return {
    id: str(row, 'id'),
    name: str(row, 'name'),
    kind: str(row, 'kind') as ProviderKind,
    baseUrl: str(row, 'base_url'),
    apiKeyEnc: row.api_key_enc instanceof Uint8Array ? row.api_key_enc : null,
    keyHint: nullableStr(row, 'key_hint'),
    defaultModel: str(row, 'default_model'),
    supportsTools: bool(row, 'supports_tools'),
    isDefault: bool(row, 'is_default'),
    lastTest: parseJson<ProviderTestResult | null>(row.last_test, null),
    createdAt: str(row, 'created_at'),
    updatedAt: str(row, 'updated_at')
  }
}

export class ConversationRepository {
  constructor(private readonly db: Database) {}

  create(title = 'New conversation'): Conversation {
    const now = new Date().toISOString()
    const conversation: Conversation = {
      id: randomUUID(),
      title,
      createdAt: now,
      updatedAt: now
    }
    this.db.raw
      .prepare('INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(conversation.id, conversation.title, conversation.createdAt, conversation.updatedAt)
    return conversation
  }

  get(id: string): Conversation | null {
    const row = this.db.raw.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as
      | Row
      | undefined
    if (!row) return null
    return {
      id: str(row, 'id'),
      title: str(row, 'title'),
      createdAt: str(row, 'created_at'),
      updatedAt: str(row, 'updated_at')
    }
  }

  list(query = ''): ConversationSummary[] {
    const q = query.trim()
    const pattern = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`
    const rows = this.db.raw
      .prepare(
        `SELECT c.*,
          (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count,
          (SELECT m.content FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1) AS last_message,
          (SELECT m.role FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1) AS last_role
         FROM conversations c
         WHERE ? = '' OR c.title LIKE ? ESCAPE '\\'
            OR EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.content LIKE ? ESCAPE '\\')
         ORDER BY c.updated_at DESC
         LIMIT 200`
      )
      .all(q, pattern, pattern) as Row[]
    return rows.map((row) => ({
      id: str(row, 'id'),
      title: str(row, 'title'),
      createdAt: str(row, 'created_at'),
      updatedAt: str(row, 'updated_at'),
      messageCount: num(row, 'message_count'),
      lastMessage: nullableStr(row, 'last_message'),
      lastRole: (nullableStr(row, 'last_role') as ChatRole | null) ?? null
    }))
  }

  rename(id: string, title: string): Conversation {
    const clean = title.trim().slice(0, 120) || 'Untitled conversation'
    this.db.raw
      .prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?')
      .run(clean, new Date().toISOString(), id)
    const conversation = this.get(id)
    if (!conversation) throw new Error('Conversation not found.')
    return conversation
  }

  touch(id: string): void {
    this.db.raw
      .prepare('UPDATE conversations SET updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), id)
  }

  delete(id: string): void {
    this.db.raw.prepare('DELETE FROM conversations WHERE id = ?').run(id)
  }

  clearAll(): number {
    const result = this.db.raw.prepare('DELETE FROM conversations').run()
    return Number(result.changes)
  }

  pruneOlderThan(cutoffIso: string): number {
    const result = this.db.raw
      .prepare('DELETE FROM conversations WHERE updated_at < ?')
      .run(cutoffIso)
    return Number(result.changes)
  }

  addMessage(input: {
    id?: string
    conversationId: string
    role: ChatRole
    content: string
    meta?: MessageMeta | null
    createdAt?: string
  }): ChatMessage {
    const message: ChatMessage = {
      id: input.id ?? randomUUID(),
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      createdAt: input.createdAt ?? new Date().toISOString(),
      meta: input.meta ?? null
    }
    this.db.raw
      .prepare(
        'INSERT INTO messages (id, conversation_id, role, content, created_at, meta) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(
        message.id,
        message.conversationId,
        message.role,
        message.content,
        message.createdAt,
        message.meta ? JSON.stringify(message.meta) : null
      )
    this.touch(message.conversationId)
    return message
  }

  getMessage(id: string): ChatMessage | null {
    const row = this.db.raw.prepare('SELECT * FROM messages WHERE id = ?').get(id) as Row | undefined
    return row ? mapMessage(row) : null
  }

  getMessages(conversationId: string): ChatMessage[] {
    const rows = this.db.raw
      .prepare(
        'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC'
      )
      .all(conversationId) as Row[]
    return rows.map(mapMessage)
  }

  getRecentMessages(conversationId: string, limit: number): ChatMessage[] {
    const safeLimit = Math.max(1, Math.min(200, limit))
    const rows = this.db.raw
      .prepare(
        `SELECT * FROM (
           SELECT *, rowid AS stable_rowid FROM messages
           WHERE conversation_id = ?
           ORDER BY created_at DESC, rowid DESC
           LIMIT ?
         ) ORDER BY created_at ASC, stable_rowid ASC`
      )
      .all(conversationId, safeLimit) as Row[]
    return rows.map(mapMessage)
  }

  updateMessage(id: string, content: string): ChatMessage {
    this.db.raw.prepare('UPDATE messages SET content = ? WHERE id = ?').run(content, id)
    const message = this.getMessage(id)
    if (!message) throw new Error('Message not found.')
    return message
  }

  deleteMessageAndFollowing(conversationId: string, messageId: string): number {
    const result = this.db.raw
      .prepare(
        `DELETE FROM messages
         WHERE conversation_id = ? AND rowid >= (
           SELECT rowid FROM messages WHERE id = ? AND conversation_id = ?
         )`
      )
      .run(conversationId, messageId, conversationId)
    this.touch(conversationId)
    return Number(result.changes)
  }

  count(): number {
    const row = this.db.raw.prepare('SELECT COUNT(*) AS n FROM messages').get() as Row
    return num(row, 'n')
  }
}

function mapMessage(row: Row): ChatMessage {
  return {
    id: str(row, 'id'),
    conversationId: str(row, 'conversation_id'),
    role: str(row, 'role') as ChatRole,
    content: str(row, 'content'),
    createdAt: str(row, 'created_at'),
    meta: parseJson<MessageMeta | null>(row.meta, null)
  }
}

export class TaskRepository {
  constructor(private readonly db: Database) {}

  create(input: {
    title: string
    kind: Task['kind']
    conversationId?: string | null
    runId?: string | null
    input?: unknown
  }): Task {
    const task: Task = {
      id: randomUUID(),
      title: input.title.slice(0, 200),
      kind: input.kind,
      status: 'queued',
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      error: null,
      result: null,
      conversationId: input.conversationId ?? null,
      runId: input.runId ?? null
    }
    this.db.raw
      .prepare(
        `INSERT INTO tasks (id, title, kind, status, created_at, conversation_id, run_id, input)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        task.id,
        task.title,
        task.kind,
        task.status,
        task.createdAt,
        task.conversationId,
        task.runId,
        input.input === undefined ? null : JSON.stringify(input.input)
      )
    return task
  }

  update(
    id: string,
    patch: Partial<{
      status: TaskStatus
      startedAt: string | null
      finishedAt: string | null
      error: string | null
      result: string | null
      runId: string | null
      cancelRequested: boolean
    }>
  ): void {
    const sets: string[] = []
    const values: (string | number | null)[] = []
    const map: Array<[keyof typeof patch, string]> = [
      ['status', 'status'],
      ['startedAt', 'started_at'],
      ['finishedAt', 'finished_at'],
      ['error', 'error'],
      ['result', 'result'],
      ['runId', 'run_id'],
      ['cancelRequested', 'cancel_requested']
    ]
    for (const [key, column] of map) {
      if (patch[key] === undefined) continue
      sets.push(`${column} = ?`)
      const value = patch[key]
      values.push(typeof value === 'boolean' ? (value ? 1 : 0) : (value as string | null))
    }
    if (!sets.length) return
    values.push(id)
    this.db.raw.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  }

  get(id: string): Task | null {
    const row = this.db.raw.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Row | undefined
    return row ? mapTask(row) : null
  }

  getInput(id: string): unknown {
    const row = this.db.raw.prepare('SELECT input FROM tasks WHERE id = ?').get(id) as
      | Row
      | undefined
    return row ? parseJson<unknown>(row.input, null) : null
  }

  list(limit = 100, status?: string): Task[] {
    const safe = Math.max(1, Math.min(300, limit))
    const rows = status
      ? (this.db.raw
          .prepare('SELECT * FROM tasks WHERE status = ? ORDER BY created_at DESC LIMIT ?')
          .all(status, safe) as Row[])
      : (this.db.raw
          .prepare('SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?')
          .all(safe) as Row[])
    return rows.map(mapTask)
  }

  detail(id: string): TaskDetail | null {
    const task = this.get(id)
    if (!task) return null
    const stepRows = this.db.raw
      .prepare('SELECT * FROM task_steps WHERE task_id = ? ORDER BY step_index ASC')
      .all(id) as Row[]
    const toolRows = this.db.raw
      .prepare('SELECT * FROM tool_runs WHERE task_id = ? ORDER BY started_at ASC, rowid ASC')
      .all(id) as Row[]
    return {
      task,
      steps: stepRows.map(mapStep),
      toolRuns: toolRows.map(mapToolRun)
    }
  }

  addStep(taskId: string, title: string, detail: string | null = null): TaskStep {
    const row = this.db.raw
      .prepare('SELECT COALESCE(MAX(step_index), -1) AS max_index FROM task_steps WHERE task_id = ?')
      .get(taskId) as Row
    const step: TaskStep = {
      id: randomUUID(),
      taskId,
      index: num(row, 'max_index') + 1,
      title,
      status: 'running',
      detail,
      createdAt: new Date().toISOString(),
      finishedAt: null
    }
    this.db.raw
      .prepare(
        `INSERT INTO task_steps (id, task_id, step_index, title, status, detail, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(step.id, step.taskId, step.index, step.title, step.status, step.detail, step.createdAt)
    return step
  }

  updateStep(
    id: string,
    status: TaskStep['status'],
    detail: string | null = null
  ): void {
    this.db.raw
      .prepare('UPDATE task_steps SET status = ?, detail = COALESCE(?, detail), finished_at = ? WHERE id = ?')
      .run(status, detail, new Date().toISOString(), id)
  }

  addToolRun(input: {
    taskId: string
    toolName: string
    argsJson: string
    approval?: ToolRun['approval']
    status?: string
  }): ToolRun {
    const run: ToolRun = {
      id: randomUUID(),
      taskId: input.taskId,
      toolName: input.toolName,
      status: input.status ?? 'requested',
      approval: input.approval ?? 'not_required',
      argsJson: input.argsJson,
      result: null,
      error: null,
      startedAt: null,
      finishedAt: null
    }
    this.db.raw
      .prepare(
        `INSERT INTO tool_runs (id, task_id, tool_name, status, approval, args_json)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(run.id, run.taskId, run.toolName, run.status, run.approval, run.argsJson)
    return run
  }

  updateToolRun(
    id: string,
    patch: Partial<{
      status: string
      approval: ToolRun['approval']
      result: string | null
      error: string | null
      startedAt: string | null
      finishedAt: string | null
    }>
  ): void {
    const sets: string[] = []
    const values: (string | null)[] = []
    const map: Array<[keyof typeof patch, string]> = [
      ['status', 'status'],
      ['approval', 'approval'],
      ['result', 'result'],
      ['error', 'error'],
      ['startedAt', 'started_at'],
      ['finishedAt', 'finished_at']
    ]
    for (const [key, column] of map) {
      if (patch[key] === undefined) continue
      sets.push(`${column} = ?`)
      values.push(patch[key] as string | null)
    }
    if (!sets.length) return
    values.push(id)
    this.db.raw.prepare(`UPDATE tool_runs SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  }

  pendingCount(): number {
    const row = this.db.raw
      .prepare(
        "SELECT COUNT(*) AS n FROM tasks WHERE status IN ('queued','planning','awaiting_confirmation','running')"
      )
      .get() as Row
    return num(row, 'n')
  }

  markInterrupted(): void {
    const now = new Date().toISOString()
    this.db.raw
      .prepare(
        `UPDATE tasks SET status = 'failed', finished_at = ?, error = COALESCE(error, 'Interrupted when IGRIS closed.')
         WHERE status IN ('queued','planning','awaiting_confirmation','running')`
      )
      .run(now)
  }

  requestCancel(taskId: string): void {
    this.db.raw
      .prepare('UPDATE tasks SET cancel_requested = 1 WHERE id = ?')
      .run(taskId)
  }

  isCancelRequested(taskId: string): boolean {
    const row = this.db.raw
      .prepare('SELECT cancel_requested FROM tasks WHERE id = ?')
      .get(taskId) as Row | undefined
    return row ? bool(row, 'cancel_requested') : false
  }
}

function mapTask(row: Row): Task {
  return {
    id: str(row, 'id'),
    title: str(row, 'title'),
    kind: str(row, 'kind') as Task['kind'],
    status: str(row, 'status') as TaskStatus,
    createdAt: str(row, 'created_at'),
    startedAt: nullableStr(row, 'started_at'),
    finishedAt: nullableStr(row, 'finished_at'),
    error: nullableStr(row, 'error'),
    result: nullableStr(row, 'result'),
    conversationId: nullableStr(row, 'conversation_id'),
    runId: nullableStr(row, 'run_id')
  }
}

function mapStep(row: Row): TaskStep {
  return {
    id: str(row, 'id'),
    taskId: str(row, 'task_id'),
    index: num(row, 'step_index'),
    title: str(row, 'title'),
    status: str(row, 'status') as TaskStep['status'],
    detail: nullableStr(row, 'detail'),
    createdAt: str(row, 'created_at'),
    finishedAt: nullableStr(row, 'finished_at')
  }
}

function mapToolRun(row: Row): ToolRun {
  return {
    id: str(row, 'id'),
    taskId: str(row, 'task_id'),
    toolName: str(row, 'tool_name'),
    status: str(row, 'status'),
    approval: str(row, 'approval') as ToolRun['approval'],
    argsJson: str(row, 'args_json'),
    result: nullableStr(row, 'result'),
    error: nullableStr(row, 'error'),
    startedAt: nullableStr(row, 'started_at'),
    finishedAt: nullableStr(row, 'finished_at')
  }
}

export class WorkspaceRepository {
  constructor(private readonly db: Database) {}

  list(): Workspace[] {
    const rows = this.db.raw
      .prepare('SELECT * FROM workspaces ORDER BY last_opened_at DESC, created_at DESC')
      .all() as Row[]
    return rows.map(mapWorkspace)
  }

  get(id: string): Workspace | null {
    const row = this.db.raw.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as
      | Row
      | undefined
    return row ? mapWorkspace(row) : null
  }

  findByPath(path: string): Workspace | null {
    const row = this.db.raw.prepare('SELECT * FROM workspaces WHERE path = ?').get(path) as
      | Row
      | undefined
    return row ? mapWorkspace(row) : null
  }

  add(name: string, path: string, kind: string | null = null): Workspace {
    const existing = this.findByPath(path)
    if (existing) {
      this.touch(existing.id)
      return this.get(existing.id) ?? existing
    }
    const workspace: Workspace = {
      id: randomUUID(),
      name,
      path,
      createdAt: new Date().toISOString(),
      lastOpenedAt: new Date().toISOString(),
      kind
    }
    this.db.raw
      .prepare(
        'INSERT INTO workspaces (id, name, path, created_at, last_opened_at, kind) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(
        workspace.id,
        workspace.name,
        workspace.path,
        workspace.createdAt,
        workspace.lastOpenedAt,
        workspace.kind
      )
    return workspace
  }

  remove(id: string): void {
    this.db.raw.prepare('DELETE FROM workspaces WHERE id = ?').run(id)
  }

  touch(id: string): void {
    this.db.raw
      .prepare('UPDATE workspaces SET last_opened_at = ? WHERE id = ?')
      .run(new Date().toISOString(), id)
  }

  setKind(id: string, kind: string): void {
    this.db.raw.prepare('UPDATE workspaces SET kind = ? WHERE id = ?').run(kind, id)
  }
}

function mapWorkspace(row: Row): Workspace {
  return {
    id: str(row, 'id'),
    name: str(row, 'name'),
    path: str(row, 'path'),
    createdAt: str(row, 'created_at'),
    lastOpenedAt: nullableStr(row, 'last_opened_at'),
    kind: nullableStr(row, 'kind')
  }
}

export class MemoryRepository {
  constructor(private readonly db: Database) {}

  list(query = ''): MemoryItem[] {
    const q = query.trim()
    const rows = q
      ? (this.db.raw
          .prepare('SELECT * FROM memories WHERE text LIKE ? ORDER BY updated_at DESC LIMIT 200')
          .all(`%${q}%`) as Row[])
      : (this.db.raw
          .prepare('SELECT * FROM memories ORDER BY updated_at DESC LIMIT 200')
          .all() as Row[])
    return rows.map((row) => ({
      id: str(row, 'id'),
      text: str(row, 'text'),
      kind: str(row, 'kind') as MemoryItem['kind'],
      createdAt: str(row, 'created_at'),
      updatedAt: str(row, 'updated_at')
    }))
  }

  add(text: string, kind: MemoryItem['kind'] = 'fact'): MemoryItem {
    const now = new Date().toISOString()
    const item: MemoryItem = {
      id: randomUUID(),
      text: text.trim(),
      kind,
      createdAt: now,
      updatedAt: now
    }
    this.db.raw
      .prepare('INSERT INTO memories (id, text, kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(item.id, item.text, item.kind, item.createdAt, item.updatedAt)
    return item
  }

  update(id: string, text: string, kind?: MemoryItem['kind']): MemoryItem {
    const existing = this.db.raw.prepare('SELECT * FROM memories WHERE id = ?').get(id) as
      | Row
      | undefined
    if (!existing) throw new Error('Memory not found.')
    const nextKind = kind ?? (str(existing, 'kind') as MemoryItem['kind'])
    this.db.raw
      .prepare('UPDATE memories SET text = ?, kind = ?, updated_at = ? WHERE id = ?')
      .run(text.trim(), nextKind, new Date().toISOString(), id)
    const item = this.list().find((entry) => entry.id === id)
    if (!item) throw new Error('Memory not found.')
    return item
  }

  delete(id: string): void {
    this.db.raw.prepare('DELETE FROM memories WHERE id = ?').run(id)
  }

  clear(): number {
    const result = this.db.raw.prepare('DELETE FROM memories').run()
    return Number(result.changes)
  }

  recent(limit = 20): MemoryItem[] {
    return this.list().slice(0, Math.max(1, Math.min(50, limit)))
  }
}

export class LogRepository {
  constructor(private readonly db: Database) {}

  add(level: LogEntry['level'], scope: string, message: string): void {
    this.db.raw
      .prepare('INSERT INTO logs (level, scope, message, created_at) VALUES (?, ?, ?, ?)')
      .run(level, scope, message.slice(0, 4000), new Date().toISOString())
    this.db.raw
      .prepare(
        'DELETE FROM logs WHERE id NOT IN (SELECT id FROM logs ORDER BY created_at DESC, id DESC LIMIT 2000)'
      )
      .run()
  }

  list(limit = 200): LogEntry[] {
    const safe = Math.max(1, Math.min(1000, limit))
    const rows = this.db.raw
      .prepare('SELECT * FROM logs ORDER BY id DESC LIMIT ?')
      .all(safe) as Row[]
    return rows.map((row) => ({
      id: num(row, 'id'),
      level: str(row, 'level') as LogEntry['level'],
      scope: str(row, 'scope'),
      message: str(row, 'message'),
      createdAt: str(row, 'created_at')
    }))
  }

  clear(): void {
    this.db.raw.prepare('DELETE FROM logs').run()
  }
}

export interface ExportBundle {
  exportedAt: string
  app: string
  version: string
  settings: unknown
  conversations: Array<Conversation & { messages: ChatMessage[] }>
  tasks: Array<Task & { steps: TaskStep[]; toolRuns: ToolRun[] }>
  workspaces: Workspace[]
  memories: MemoryItem[]
}

export function buildExportBundle(
  db: Database,
  app: string,
  version: string
): ExportBundle {
  const conversations = new ConversationRepository(db)
  const tasks = new TaskRepository(db)
  const workspaces = new WorkspaceRepository(db)
  const memories = new MemoryRepository(db)
  const settings = new SettingsRepository(db)
  const conversationList = conversations.list().map((summary) => {
    const conversation = conversations.get(summary.id) ?? {
      id: summary.id,
      title: summary.title,
      createdAt: summary.createdAt,
      updatedAt: summary.updatedAt
    }
    return { ...conversation, messages: conversations.getMessages(summary.id) }
  })
  const taskList = tasks.list(300).map((task) => {
    const detail = tasks.detail(task.id)
    return {
      ...task,
      steps: detail?.steps ?? [],
      toolRuns: detail?.toolRuns ?? []
    }
  })
  return {
    exportedAt: new Date().toISOString(),
    app,
    version,
    settings: settings.get(),
    conversations: conversationList,
    tasks: taskList,
    workspaces: workspaces.list(),
    memories: memories.list()
  }
}

export type { FileHit }
