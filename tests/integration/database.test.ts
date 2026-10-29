import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Database } from '../../src/main/storage/database'
import {
  ConversationRepository,
  ProviderRepository,
  SettingsRepository,
  TaskRepository,
  WorkspaceRepository
} from '../../src/main/storage/repositories'
import type { ProviderRow } from '../../src/main/storage/repositories'

let db: Database
let settings: SettingsRepository
let conversations: ConversationRepository
let providers: ProviderRepository
let tasks: TaskRepository
let workspaces: WorkspaceRepository

function provider(id: string, overrides: Partial<ProviderRow> = {}): ProviderRow {
  const now = new Date().toISOString()
  return {
    id,
    name: id,
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyEnc: new Uint8Array([1, 2, 3, 4]),
    keyHint: '…abcd',
    defaultModel: 'gpt-test',
    supportsTools: true,
    isDefault: false,
    lastTest: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  }
}

beforeEach(() => {
  db = new Database(':memory:')
  settings = new SettingsRepository(db)
  conversations = new ConversationRepository(db)
  providers = new ProviderRepository(db)
  tasks = new TaskRepository(db)
  workspaces = new WorkspaceRepository(db)
})

afterEach(() => {
  db.close()
})

describe('database migrations', () => {
  it('creates a schema and reports a nonzero page allocation', () => {
    expect(db.bytes()).toBeGreaterThan(0)
    const version = db.raw.prepare('PRAGMA user_version').get() as { user_version?: number }
    expect(version.user_version).toBe(1)
  })
})

describe('SettingsRepository', () => {
  it('round-trips one settings document', () => {
    expect(settings.get()).toBeNull()
    settings.save({ appearance: { accent: 'violet' }, onboardingComplete: true })
    expect(settings.get()).toEqual({ appearance: { accent: 'violet' }, onboardingComplete: true })
    settings.save({ appearance: { accent: 'silver' } })
    expect(settings.get()).toEqual({ appearance: { accent: 'silver' } })
  })
})

describe('ConversationRepository', () => {
  it('stores messages, searches transcripts, and lists summaries', () => {
    const conversation = conversations.create('Architecture review')
    conversations.addMessage({
      conversationId: conversation.id,
      role: 'user',
      content: 'Please inspect the alpha module.',
      createdAt: '2026-01-01T00:00:01.000Z'
    })
    conversations.addMessage({
      conversationId: conversation.id,
      role: 'assistant',
      content: 'The alpha module has one risk.',
      createdAt: '2026-01-01T00:00:02.000Z'
    })

    const list = conversations.list()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({
      id: conversation.id,
      messageCount: 2,
      lastMessage: 'The alpha module has one risk.',
      lastRole: 'assistant'
    })
    expect(conversations.list('alpha')).toHaveLength(1)
    expect(conversations.list('missing')).toHaveLength(0)
    expect(conversations.getMessages(conversation.id).map((message) => message.role)).toEqual([
      'user',
      'assistant'
    ])
  })

  it('renames, trims titles, and cascades message deletion', () => {
    const conversation = conversations.create()
    conversations.addMessage({ conversationId: conversation.id, role: 'user', content: 'hello' })
    const renamed = conversations.rename(conversation.id, '  A better title  ')
    expect(renamed.title).toBe('A better title')
    expect(conversations.rename(conversation.id, '').title).toBe('Untitled conversation')

    conversations.delete(conversation.id)
    expect(conversations.get(conversation.id)).toBeNull()
    expect(conversations.getMessages(conversation.id)).toEqual([])
    expect(conversations.count()).toBe(0)
  })

  it('deletes a message and every following message', () => {
    const conversation = conversations.create()
    const first = conversations.addMessage({
      conversationId: conversation.id,
      role: 'user',
      content: 'one',
      createdAt: '2026-01-01T00:00:01.000Z'
    })
    conversations.addMessage({
      conversationId: conversation.id,
      role: 'assistant',
      content: 'two',
      createdAt: '2026-01-01T00:00:02.000Z'
    })
    conversations.addMessage({
      conversationId: conversation.id,
      role: 'user',
      content: 'three',
      createdAt: '2026-01-01T00:00:03.000Z'
    })

    expect(conversations.deleteMessageAndFollowing(conversation.id, first.id)).toBe(3)
    expect(conversations.getMessages(conversation.id)).toEqual([])
  })

  it('returns the most recent messages in chronological order', () => {
    const conversation = conversations.create()
    for (let index = 0; index < 6; index += 1) {
      conversations.addMessage({
        conversationId: conversation.id,
        role: index % 2 ? 'assistant' : 'user',
        content: `message ${index}`,
        createdAt: `2026-01-01T00:00:0${index}.000Z`
      })
    }
    const recent = conversations.getRecentMessages(conversation.id, 3)
    expect(recent.map((message) => message.content)).toEqual([
      'message 3',
      'message 4',
      'message 5'
    ])
  })
})

describe('ProviderRepository', () => {
  it('keeps exactly one default provider', () => {
    providers.save(provider('a', { isDefault: true }))
    providers.save(provider('b', { isDefault: true }))
    expect(providers.getDefault()?.id).toBe('b')
    expect(providers.get('a')?.isDefault).toBe(false)

    providers.setDefault('a')
    expect(providers.getDefault()?.id).toBe('a')
    expect(providers.get('b')?.isDefault).toBe(false)
    expect(providers.count()).toBe(2)
  })

  it('round-trips encrypted key bytes and test results', () => {
    const lastTest = { ok: true, message: 'Connected', at: new Date().toISOString() }
    providers.save(provider('a', { lastTest }))
    const stored = providers.get('a')
    expect(stored?.apiKeyEnc).toEqual(new Uint8Array([1, 2, 3, 4]))
    expect(stored?.lastTest).toEqual(lastTest)
    providers.patch('a', { defaultModel: 'gpt-next' })
    expect(providers.get('a')?.defaultModel).toBe('gpt-next')
    providers.remove('a')
    expect(providers.get('a')).toBeNull()
  })
})

describe('TaskRepository', () => {
  it('records ordered steps and tool runs with a complete detail view', () => {
    const task = tasks.create({ title: 'Inspect workspace', kind: 'tool' })
    const firstStep = tasks.addStep(task.id, 'Scan files')
    const secondStep = tasks.addStep(task.id, 'Summarize findings')
    expect(firstStep.index).toBe(0)
    expect(secondStep.index).toBe(1)
    tasks.updateStep(firstStep.id, 'completed', 'Scanned 12 files')

    const run = tasks.addToolRun({
      taskId: task.id,
      toolName: 'list_files',
      argsJson: '{"path":""}',
      status: 'approved'
    })
    tasks.updateToolRun(run.id, {
      status: 'completed',
      result: '12 files',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString()
    })

    const detail = tasks.detail(task.id)
    expect(detail?.task.status).toBe('queued')
    expect(detail?.steps.map((step) => step.title)).toEqual(['Scan files', 'Summarize findings'])
    expect(detail?.steps[0].status).toBe('completed')
    expect(detail?.toolRuns[0]).toMatchObject({ toolName: 'list_files', result: '12 files' })
  })

  it('marks interrupted work as failed and honours cancellation flags', () => {
    const active = tasks.create({ title: 'Long job', kind: 'chat' })
    const queued = tasks.create({ title: 'Queued job', kind: 'chat' })
    tasks.update(active.id, { status: 'running', startedAt: new Date().toISOString() })
    expect(tasks.pendingCount()).toBe(2)

    tasks.requestCancel(active.id)
    expect(tasks.isCancelRequested(active.id)).toBe(true)
    expect(tasks.isCancelRequested(queued.id)).toBe(false)

    tasks.markInterrupted()
    expect(tasks.get(active.id)).toMatchObject({
      status: 'failed',
      error: 'Interrupted when IGRIS closed.'
    })
    expect(tasks.get(queued.id)?.status).toBe('failed')
    expect(tasks.pendingCount()).toBe(0)
  })
})

describe('WorkspaceRepository', () => {
  it('deduplicates approved folders and updates their kind', () => {
    const first = workspaces.add('IGRIS', 'C:\\Projects\\igris', 'node')
    const duplicate = workspaces.add('Renamed', 'C:\\Projects\\igris')
    expect(duplicate.id).toBe(first.id)
    expect(workspaces.list()).toHaveLength(1)

    workspaces.setKind(first.id, 'typescript')
    expect(workspaces.get(first.id)?.kind).toBe('typescript')
    workspaces.remove(first.id)
    expect(workspaces.list()).toHaveLength(0)
  })
})
