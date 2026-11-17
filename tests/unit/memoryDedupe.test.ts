import { describe, expect, it, vi } from 'vitest'
import { findSimilarMemory } from '../../src/shared/similar'
import { createToolRegistry } from '../../src/main/tools/registry'
import type { MemoryLike } from '../../src/shared/similar'

describe('findSimilarMemory', () => {
  const existing: MemoryLike[] = [
    { id: 'm1', text: 'The user prefers short, direct answers.' },
    { id: 'm2', text: 'Work laptop is a ThinkPad running Windows 11.' }
  ]

  it('catches an exact duplicate after normalization', () => {
    const match = findSimilarMemory('The user prefers short, direct answers!', existing)
    expect(match?.id).toBe('m1')
    expect(match?.similarity).toBe(1)
  })

  it('ignores case, punctuation, and whitespace differences', () => {
    const match = findSimilarMemory('  the USER prefers   short direct answers.  ', existing)
    expect(match?.id).toBe('m1')
  })

  it('catches a near-identical rephrasing via token overlap', () => {
    const match = findSimilarMemory('The user prefers short and direct answers.', existing)
    expect(match?.id).toBe('m1')
  })

  it('does not flag genuinely different text', () => {
    expect(findSimilarMemory('Likes black coffee in the morning.', existing)).toBeNull()
    expect(findSimilarMemory('The user is called Sam and works at Northwind.', existing)).toBeNull()
  })

  it('returns null for blank text or an empty store', () => {
    expect(findSimilarMemory('   ', existing)).toBeNull()
    expect(findSimilarMemory('anything', [])).toBeNull()
  })

  it('reports the most similar entry when several exceed the threshold', () => {
    const match = findSimilarMemory('The user prefers short direct answers.', [
      { id: 'a', text: 'The user prefers short direct replies today.' },
      { id: 'b', text: 'The user prefers short direct answers.' }
    ])
    expect(match?.id).toBe('b')
  })
})

describe('save_memory duplicate gate', () => {
  function makeRegistry(existing: MemoryLike[], add: ReturnType<typeof vi.fn>) {
    return createToolRegistry({
      workspaces: { list: () => [] },
      files: {},
      terminal: {},
      apps: { list: () => [] },
      screen: { status: () => ({ available: false, detail: '' }) },
      browser: {},
      control: {},
      desktop: {},
      managedBrowser: {},
      memories: { list: () => existing, add },
      tasks: { savePlan: () => undefined },
      settings: () => ({}) as never,
      logger: { warn: () => undefined, info: () => undefined }
    } as never)
  }

  const CONTEXT = {
    taskId: 'task-1',
    signal: new AbortController().signal,
    confirm: async () => true
  }

  it('refuses to save a duplicate and leaves the store untouched', async () => {
    const add = vi.fn()
    const registry = makeRegistry(
      [{ id: 'm1', text: 'The user prefers short, direct answers.' }],
      add
    )
    const outcome = await registry.get('save_memory')!.run(
      { text: 'The user prefers short direct answers.' },
      CONTEXT
    )
    expect(outcome.text).toContain('Not saved')
    expect(outcome.text).toContain('m1')
    expect(add).not.toHaveBeenCalled()
  })

  it('still saves genuinely new text', async () => {
    const add = vi.fn(() => ({ id: 'new-1' }))
    const registry = makeRegistry(
      [{ id: 'm1', text: 'The user prefers short, direct answers.' }],
      add
    )
    const outcome = await registry.get('save_memory')!.run(
      { text: 'Never open terminal windows without saying why.' },
      CONTEXT
    )
    expect(outcome.text).toContain('Saved memory')
    expect(add).toHaveBeenCalledTimes(1)
  })
})
