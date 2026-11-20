import { describe, expect, it, vi } from 'vitest'
import { ChatEngine } from '../../src/main/ai/chatEngine'
import { AppError } from '../../src/main/security/errors'
import type { ProviderStreamEvent } from '../../src/main/ai/types'

const DEFAULT_SETTINGS = {
  ai: { streaming: false, contextMessages: 10, maxToolIterations: 10, temperature: 0.3 }
}

function makeEngine(
  retryDelay: (ms: number) => Promise<void> = () => Promise.resolve()
): ChatEngine {
  const engine = new ChatEngine({
    conversations: {},
    memories: { recent: () => [] },
    workspaces: { list: () => [] },
    tasks: {},
    providers: {},
    settings: { get: () => DEFAULT_SETTINGS },
    tools: {},
    toolRuntime: {},
    control: {},
    logger: { warn: () => undefined, info: () => undefined },
    emit: () => undefined
  } as never)
  ;(engine as unknown as { retryDelay: (ms: number) => Promise<void> }).retryDelay = retryDelay
  return engine
}

type Behavior = 'throw' | 'throw-after-output' | 'text'

function adapterWith(behaviors: Behavior[]): {
  adapter: { stream: () => AsyncGenerator<ProviderStreamEvent> }
  callCount: () => number
} {
  const calls = { count: 0 }
  const adapter = {
    stream: async function* (): AsyncGenerator<ProviderStreamEvent> {
      const behavior = behaviors[calls.count] ?? 'text'
      calls.count += 1
      if (behavior === 'throw') throw new AppError('PROVIDER', 'server hiccup')
      if (behavior === 'throw-after-output') {
        yield { type: 'text', text: 'partial' }
        throw new AppError('PROVIDER', 'stream died')
      }
      yield { type: 'text', text: 'ok' }
    }
  }
  return { adapter, callCount: () => calls.count }
}

function runTurn(engine: ChatEngine, adapter: unknown): Promise<unknown> {
  const active = {
    controller: new AbortController(),
    runId: 'run-1',
    provider: {
      adapter,
      provider: { name: 'Test' },
      model: 'test-model',
      runtime: { supportsTools: true }
    }
  }
  const request = {
    model: 'test-model',
    system: 'test',
    messages: [{ role: 'user' as const, content: 'hi' }],
    tools: [],
    temperature: 0,
    maxOutputTokens: 64,
    streaming: false
  }
  return (
    engine as unknown as {
      streamTurn: (active: unknown, request: unknown) => Promise<unknown>
    }
  ).streamTurn(active, request)
}

describe('provider transient retry', () => {
  it('retries a transient failure that produced no output', async () => {
    const { adapter, callCount } = adapterWith(['throw', 'text'])

    const result = (await runTurn(makeEngine(), adapter)) as { text: string }
    expect(result.text).toBe('ok')
    expect(callCount()).toBe(2)
  })

  it('does not retry once output was already delivered', async () => {
    const { adapter, callCount } = adapterWith(['throw-after-output', 'text'])

    await expect(runTurn(makeEngine(), adapter)).rejects.toThrow('stream died')
    expect(callCount()).toBe(1)
  })

  it('does not retry non-retryable quota failures', async () => {
    let attempts = 0
    const adapter = {
      stream: async function* (): AsyncGenerator<ProviderStreamEvent> {
        attempts += 1
        throw new AppError('QUOTA', 'daily quota exhausted', { retryable: false })
      }
    }

    await expect(runTurn(makeEngine(), adapter)).rejects.toThrow('daily quota exhausted')
    expect(attempts).toBe(1)
  })

  it('gives up after the third attempt', async () => {
    const { adapter, callCount } = adapterWith(['throw', 'throw', 'throw'])

    await expect(runTurn(makeEngine(), adapter)).rejects.toThrow('server hiccup')
    expect(callCount()).toBe(3)
  })

  it('waits between attempts', async () => {
    vi.useFakeTimers()
    try {
      const delays: number[] = []
      const engine = makeEngine((ms) => {
        delays.push(ms)
        return new Promise((resolve) => setTimeout(resolve, ms))
      })
      const { adapter, callCount } = adapterWith(['throw', 'throw', 'text'])

      const promise = runTurn(engine, adapter)
      await vi.advanceTimersByTimeAsync(2_000)
      await vi.advanceTimersByTimeAsync(6_000)
      const result = (await promise) as { text: string }
      expect(result.text).toBe('ok')
      expect(callCount()).toBe(3)
      expect(delays).toEqual([2_000, 6_000])
    } finally {
      vi.useRealTimers()
    }
  })
})
