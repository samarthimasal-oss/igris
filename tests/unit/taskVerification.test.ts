import { describe, expect, it, vi } from 'vitest'
import { ChatEngine } from '../../src/main/ai/chatEngine'
import { AppError } from '../../src/main/security/errors'
import type { ProviderStreamEvent } from '../../src/main/ai/types'
import type { ResolvedProvider } from '../../src/main/services/providerService'
import type { TaskVerification } from '@shared/types'

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
    autoFallback: true,
    verifyActions: true
  },
  voice: { ttsEnabled: false, ttsVoice: '', ttsRate: 1, handsFree: false },
  onboardingComplete: true
}

interface TaskFake {
  steps: string[]
  verifications: TaskVerification[]
  plans: unknown[]
  plan: { steps: Array<{ title: string; status: string; evidence: string | null }> } | null
}

function resolvedFixture(texts: string[], failure?: AppError): ResolvedProvider {
  return {
    provider: { id: 'primary', name: 'primary', kind: 'openai' },
    model: 'primary-model',
    runtime: { supportsTools: true },
    adapter: {
      stream: async function* (): AsyncGenerator<ProviderStreamEvent> {
        if (failure) throw failure
        for (const text of texts) yield { type: 'text', text }
      }
    }
  } as unknown as ResolvedProvider
}

function makeEngine(task: TaskFake, verifyActions = true): ChatEngine {
  const settings = structuredClone(BASE_SETTINGS) as typeof BASE_SETTINGS
  settings.ai.verifyActions = verifyActions
  return new ChatEngine({
    conversations: {},
    memories: { recent: () => [] },
    workspaces: { list: () => [] },
    tasks: {
      addStep: () => ({ id: 'step-1' }),
      finishStep: () => undefined,
      setVerification: (_taskId: string, verification: TaskVerification) => {
        task.verifications.push(verification)
      },
      savePlan: (_taskId: string, plan: unknown) => {
        task.plans.push(plan)
      },
      get: () => ({ plan: task.plan })
    },
    providers: { fallbackChain: () => [] },
    settings: { get: () => settings },
    tools: {},
    toolRuntime: {},
    control: {},
    logger: { warn: () => undefined, info: () => undefined },
    emit: () => undefined
  } as never)
}

function makeActive(
  toolExecutions: Array<{ name: string; result?: string; error?: string }>,
  provider: ResolvedProvider
): unknown {
  return {
    controller: new AbortController(),
    runId: 'run-1',
    taskId: 'task-1',
    conversationId: 'c1',
    toolExecutions,
    provider
  }
}

function runVerify(
  engine: ChatEngine,
  active: unknown
): Promise<void> {
  return (
    engine as unknown as {
      verifyOutcome: (active: unknown, options: unknown) => Promise<void>
    }
  ).verifyOutcome(active, { userMessage: { content: 'Open YouTube and play a song' } })
}

const BROWSER_ACTION = { name: 'browser', result: 'Navigated to youtube.com; player shows Pause' }

describe('verifyOutcome', () => {
  it('persists a verified verdict and merges step statuses into the plan', async () => {
    const task: TaskFake = {
      steps: [],
      verifications: [],
      plans: [],
      plan: {
        steps: [
          { title: 'Open the page', status: 'pending', evidence: null },
          { title: 'Press play', status: 'pending', evidence: null }
        ]
      }
    }
    const reply = JSON.stringify({
      status: 'verified',
      evidence: 'The browser result shows the player is now in the Pause state, so playback is running.',
      steps: [
        { index: 1, status: 'completed', evidence: 'Navigation result confirms the page.' },
        { index: 2, status: 'completed', evidence: 'Player shows Pause.' }
      ]
    })
    const engine = makeEngine(task)
    await runVerify(engine, makeActive([BROWSER_ACTION], resolvedFixture([reply])))

    expect(task.verifications).toHaveLength(1)
    expect(task.verifications[0]?.status).toBe('verified')
    expect(task.plans[0]).toMatchObject({
      steps: [
        { title: 'Open the page', status: 'completed' },
        { title: 'Press play', status: 'completed' }
      ]
    })
  })

  it('fails the run when the verifier verdict is failed', async () => {
    const task: TaskFake = { steps: [], verifications: [], plans: [], plan: null }
    const reply = JSON.stringify({
      status: 'failed',
      evidence: 'The browser result shows a paused player, not the requested playback.'
    })
    const engine = makeEngine(task)

    await expect(
      runVerify(engine, makeActive([BROWSER_ACTION], resolvedFixture([reply])))
    ).rejects.toThrow('The verifier could not confirm the outcome')
    expect(task.verifications[0]?.status).toBe('failed')
  })

  it('records unverified for an unparsable verifier reply', async () => {
    const task: TaskFake = { steps: [], verifications: [], plans: [], plan: null }
    const engine = makeEngine(task)

    await runVerify(
      engine,
      makeActive([BROWSER_ACTION], resolvedFixture(['It looks like it worked.']))
    )
    expect(task.verifications[0]?.status).toBe('unverified')
  })

  it('records unverified when the verifier call itself fails', async () => {
    const task: TaskFake = { steps: [], verifications: [], plans: [], plan: null }
    const engine = makeEngine(task)

    await runVerify(
      engine,
      makeActive(
        [BROWSER_ACTION],
        resolvedFixture([], new AppError('NETWORK', 'verifier unreachable'))
      )
    )
    expect(task.verifications[0]?.status).toBe('unverified')
    expect(task.verifications[0]?.evidence).toContain('verifier unreachable')
  })

  it('propagates cancellation instead of swallowing it', async () => {
    const task: TaskFake = { steps: [], verifications: [], plans: [], plan: null }
    const engine = makeEngine(task)

    await expect(
      runVerify(
        engine,
        makeActive([BROWSER_ACTION], resolvedFixture([], new AppError('CANCELLED', 'stopped')))
      )
    ).rejects.toThrow('stopped')
    expect(task.verifications).toHaveLength(0)
  })

  it('skips the verifier without consequential tools or when disabled', async () => {
    const task: TaskFake = { steps: [], verifications: [], plans: [], plan: null }
    const stream = vi.fn()
    const silentProvider = {
      ...resolvedFixture(['x']),
      adapter: { stream }
    } as unknown as ResolvedProvider
    const engine = makeEngine(task)
    await runVerify(engine, makeActive([{ name: 'search_files', result: 'found files' }], silentProvider))
    expect(task.verifications).toHaveLength(0)
    expect(stream).not.toHaveBeenCalled()

    const disabledEngine = makeEngine(task, false)
    await runVerify(disabledEngine, makeActive([BROWSER_ACTION], silentProvider))
    expect(task.verifications).toHaveLength(0)
    expect(stream).not.toHaveBeenCalled()
  })
})

describe('parseVerdict', () => {
  function parser(engine: ChatEngine): (text: string) => unknown {
    return (
      engine as unknown as { parseVerdict: (text: string) => unknown }
    ).parseVerdict.bind(engine)
  }

  it('accepts a valid verdict JSON, even embedded in prose', () => {
    const task: TaskFake = { steps: [], verifications: [], plans: [], plan: null }
    const parse = parser(makeEngine(task))
    expect(parse('Sure! {"status":"verified","evidence":"result shows it"} done')).toMatchObject({
      status: 'verified',
      evidence: 'result shows it'
    })
  })

  it('downgrades unknown statuses and missing evidence', () => {
    const task: TaskFake = { steps: [], verifications: [], plans: [], plan: null }
    const parse = parser(makeEngine(task))
    expect(parse('{"status":"probably-fine","evidence":""}')).toMatchObject({
      status: 'unverified'
    })
    expect(parse('no json here')).toMatchObject({ status: 'unverified' })
  })
})
