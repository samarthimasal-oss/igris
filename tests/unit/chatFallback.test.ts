import { describe, expect, it, vi } from 'vitest'
import { ChatEngine } from '../../src/main/ai/chatEngine'
import { AppError } from '../../src/main/security/errors'
import type { ProviderStreamEvent } from '../../src/main/ai/types'
import type { ResolvedProvider } from '../../src/main/services/providerService'

const BASE_SETTINGS = {
  appearance: {},
  desktop: {},
  permissions: {},
  privacy: {},
  ai: {
    contextMessages: 10,
    maxToolIterations: 10,
    temperature: 0,
    streaming: false,
    systemInstructions: '',
    confirmSensitiveActions: true,
    autoFallback: true
  },
  onboardingComplete: true
}

interface ProviderFixture {
  name: string
  model: string
  behavior: 'ok' | 'fail'
  failure?: AppError
}

function resolvedFixture(fixture: ProviderFixture): ResolvedProvider {
  return {
    provider: { id: fixture.name, name: fixture.name, kind: 'openai' },
    model: fixture.model,
    runtime: { supportsTools: true },
    adapter: {
      stream: async function* (): AsyncGenerator<ProviderStreamEvent> {
        if (fixture.behavior === 'fail') throw fixture.failure
        yield { type: 'text', text: `${fixture.name} says hi` }
      }
    }
  } as unknown as ResolvedProvider
}

function makeEngine(
  chain: ResolvedProvider[],
  overrides: { autoFallback?: boolean; onEvent?: (event: unknown) => void } = {}
): ChatEngine {
  const settings = structuredClone(BASE_SETTINGS) as typeof BASE_SETTINGS
  if (overrides.autoFallback !== undefined) settings.ai.autoFallback = overrides.autoFallback
  const fallbackChain = vi.fn(() => chain.filter((entry) => entry.provider.id !== 'primary'))
  const logger = { warn: () => undefined, info: () => undefined }
  return new ChatEngine({
    conversations: {},
    memories: { recent: () => [] },
    workspaces: { list: () => [] },
    tasks: {},
    providers: { fallbackChain },
    settings: { get: () => settings },
    tools: {},
    toolRuntime: {},
    control: {},
    logger,
    emit: (event: unknown) => overrides.onEvent?.(event)
  } as never)
}

function runTurn(engine: ChatEngine, adapter: unknown): Promise<unknown> {
  const active = {
    controller: new AbortController(),
    runId: 'run-1',
    provider: adapter
  }
  const request = {
    sessionId: 'c1',
    system: 'test',
    messages: [{ role: 'user' as const, content: 'hi' }],
    tools: [],
    temperature: 0,
    maxOutputTokens: 64,
    streaming: false
  }
  return (
    engine as unknown as {
      streamTurnWithFallback: (active: unknown, request: unknown) => Promise<unknown>
    }
  ).streamTurnWithFallback(active, request)
}

describe('provider fallback', () => {
  it('switches to the next configured provider when the primary fails', async () => {
    const events: unknown[] = []
    const primary = resolvedFixture({
      name: 'primary',
      model: 'primary-model',
      behavior: 'fail',
      failure: new AppError('QUOTA', 'primary quota exhausted', { retryable: false })
    })
    const fallback = resolvedFixture({ name: 'fallback', model: 'fallback-model', behavior: 'ok' })
    const engine = makeEngine([primary, fallback], { onEvent: (event) => events.push(event) })

    const result = (await runTurn(engine, primary)) as { text: string }
    expect(result.text).toBe('fallback says hi')
    expect(events).toContainEqual(
      expect.objectContaining({
        status: 'working',
        detail: 'Switching to fallback'
      })
    )
  })

  it('does not switch after output was already delivered', async () => {
    const primary = resolvedFixture({ name: 'primary', model: 'm', behavior: 'ok' })
    // Deliver text, then fail with a fallback-eligible code.
    const originalStream = primary.adapter.stream
    primary.adapter = {
      stream: async function* (): AsyncGenerator<ProviderStreamEvent> {
        yield { type: 'text', text: 'partial' }
        throw new AppError('PROVIDER', 'stream died mid-run')
      }
    } as unknown as ResolvedProvider['adapter']
    const fallback = resolvedFixture({ name: 'fallback', model: 'm', behavior: 'ok' })
    const engine = makeEngine([primary, fallback])
    void originalStream

    await expect(runTurn(engine, primary)).rejects.toThrow('stream died mid-run')
  })

  it('does not switch for non-provider failures', async () => {
    const primary = resolvedFixture({
      name: 'primary',
      model: 'm',
      behavior: 'fail',
      failure: new AppError('VALIDATION', 'bad input')
    })
    const fallback = resolvedFixture({ name: 'fallback', model: 'm', behavior: 'ok' })
    const engine = makeEngine([primary, fallback])

    await expect(runTurn(engine, primary)).rejects.toThrow('bad input')
  })

  it('stays on the primary provider when fallback is disabled', async () => {
    const primary = resolvedFixture({
      name: 'primary',
      model: 'm',
      behavior: 'fail',
      failure: new AppError('QUOTA', 'quota exhausted')
    })
    const fallback = resolvedFixture({ name: 'fallback', model: 'm', behavior: 'ok' })
    const engine = makeEngine([primary, fallback], { autoFallback: false })

    await expect(runTurn(engine, primary)).rejects.toThrow('quota exhausted')
  })

  it('reports the original failure when every candidate fails', async () => {
    const primary = resolvedFixture({
      name: 'primary',
      model: 'm',
      behavior: 'fail',
      failure: new AppError('QUOTA', 'primary down')
    })
    const fallback = resolvedFixture({
      name: 'fallback',
      model: 'm',
      behavior: 'fail',
      failure: new AppError('NETWORK', 'fallback unreachable')
    })
    const engine = makeEngine([primary, fallback])

    await expect(runTurn(engine, primary)).rejects.toThrow('primary down')
  })
})
