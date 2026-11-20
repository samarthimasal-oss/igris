import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { ControlSessionService } from '../../src/main/control/sessionService'
import { DesktopService, type DesktopServiceDeps } from '../../src/main/control/desktopService'
import type { OperatorWindowInfo } from '../../src/main/control/types'

const tempRoot = mkdtempSync(join(tmpdir(), 'igris-desktop-test-'))
afterAll(() => rmSync(tempRoot, { recursive: true, force: true }))

const self = { pid: 999, processName: 'IGRIS' }

function window(overrides: Partial<OperatorWindowInfo> = {}): OperatorWindowInfo {
  return {
    handle: 101,
    title: 'Untitled - Notepad',
    className: 'Notepad',
    process: 'notepad',
    pid: 200,
    rect: { x: 0, y: 0, width: 800, height: 600 },
    minimized: false,
    maximized: false,
    foreground: true,
    elevated: false,
    ...overrides
  }
}

const baseState = {
  version: 1,
  cursor: { x: 10, y: 20 },
  foreground: window(),
  virtualScreen: { x: 0, y: 0, width: 1920, height: 1080 },
  monitors: [
    { x: 0, y: 0, width: 1920, height: 1080, work: { x: 0, y: 0, width: 1920, height: 1020 }, primary: true }
  ],
  processElevated: false,
  windows: 1
}

function makeOperator(overrides: Record<string, (args: Record<string, unknown>) => unknown> = {}) {
  const requests: Array<{ cmd: string; args: Record<string, unknown> }> = []
  const operator = {
    requests,
    async request<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
      requests.push({ cmd, args })
      if (overrides[cmd]) return overrides[cmd](args) as T
      switch (cmd) {
        case 'state':
          return baseState as T
        case 'listWindows':
          return [window()] as T
        case 'foreground':
          return window() as T
        case 'windowAt':
          return window() as T
        case 'windowInfo':
          return window({ handle: Number(args.handle) }) as T
        case 'focusWindow':
          return { focused: true, window: window() } as T
        case 'getElements':
          return {
            window: window(),
            elements: [
              {
                refId: '42.1',
                role: 'Edit',
                name: 'Text editor',
                automationId: '15',
                bounds: { x: 10, y: 10, width: 300, height: 100 },
                enabled: true,
                offscreen: false,
                password: false,
                focusable: true,
                patterns: ['ValuePattern', 'TextPattern']
              }
            ],
            truncated: false
          } as T
        case 'screenshot':
          writeFileSync(String(args.path), 'png-bytes')
          return { path: args.path, x: 0, y: 0, width: 1920, height: 1080, capturedAt: '' } as T
        case 'showWindow':
          return { state: String(args.state), window: window({ minimized: args.state === 'minimize' }) } as T
        case 'click':
        case 'moveMouse':
        case 'drag':
        case 'scroll':
        case 'typeText':
        case 'keyChord':
        case 'closeWindow':
        case 'invokeElement':
        case 'setElementValue':
          return {} as T
        default:
          throw new Error(`unexpected operator command: ${cmd}`)
      }
    }
  }
  return operator
}

function makeService(
  operator = makeOperator(),
  options: {
    confirm?: (request: { title: string; description: string }) => Promise<boolean>
    apps?: DesktopServiceDeps['apps']
  } = {}
) {
  const sessions = new ControlSessionService(() => Date.now(), {
    ttlMs: 20 * 60_000,
    maxActions: 120,
    maxTurns: 30
  })
  const confirmations: Array<{ title: string; description: string }> = []
  const service = new DesktopService({
    operator,
    sessions,
    apps:
      options.apps ??
      ({
        list: () => [
          { id: 'notepad', name: 'Notepad', description: '', available: true, source: 'builtin' }
        ],
        launch: async () => 'Launched Notepad.'
      } as DesktopServiceDeps['apps']),
    logger: { info: () => undefined, warn: () => undefined },
    screenshotsDir: tempRoot,
    encodeScreenshot: async () => ({ mimeType: 'image/jpeg', data: 'abc' }),
    openPath: async () => '',
    self,
    startMenuRoots: [],
    sleep: async () => undefined
  })
  const confirm = async (request: { title: string; description: string }): Promise<boolean> => {
    confirmations.push(request)
    if (options.confirm) return options.confirm(request)
    return true
  }
  return { service, sessions, confirmations, confirm, operator }
}

function createSession(sessions: ControlSessionService, taskId = 'task-1'): void {
  sessions.create(taskId, 'Test desktop control', 'desktop')
}

describe('DesktopService', () => {
  it('refuses actions without an approved session', async () => {
    const { service, confirm } = makeService()
    await expect(
      service.run({ action: 'state' }, { taskId: 'task-1', signal: new AbortController().signal, confirm })
    ).rejects.toThrow(/control session/i)
  })

  it('reports state and counts the action', async () => {
    const { service, sessions, confirm } = makeService()
    createSession(sessions)
    const outcome = await service.run(
      { action: 'state' },
      { taskId: 'task-1', signal: new AbortController().signal, confirm }
    )
    expect(outcome.text).toContain('Untitled - Notepad')
    expect(outcome.text).toContain('Virtual screen')
    expect(sessions.stateForTask('task-1')?.actions).toBe(1)
  })

  it('blocks elevated windows before clicking', async () => {
    const operator = makeOperator({
      windowAt: () => window({ process: 'adminapp', elevated: true, title: 'Administrator: Command Prompt' })
    })
    const { service, sessions, confirm } = makeService(operator)
    createSession(sessions)
    await expect(
      service.run(
        { action: 'click', x: 100, y: 100 },
        { taskId: 'task-1', signal: new AbortController().signal, confirm }
      )
    ).rejects.toThrow(/elevated/i)
    expect(operator.requests.some((request) => request.cmd === 'click')).toBe(false)
  })

  it('blocks credential managers before typing', async () => {
    const operator = makeOperator({
      foreground: () => window({ process: '1Password', title: '1Password' })
    })
    const { service, sessions, confirm } = makeService(operator)
    createSession(sessions)
    await expect(
      service.run(
        { action: 'type', text: 'secret' },
        { taskId: 'task-1', signal: new AbortController().signal, confirm }
      )
    ).rejects.toThrow(/credential/i)
    expect(operator.requests.some((request) => request.cmd === 'typeText')).toBe(false)
  })

  it('asks before closing a window and respects denial', async () => {
    const operator = makeOperator()
    const { service, sessions, confirmations, confirm } = makeService(operator, {
      confirm: async () => false
    })
    createSession(sessions)
    const outcome = await service.run(
      { action: 'window', state: 'close' },
      { taskId: 'task-1', signal: new AbortController().signal, confirm }
    )
    expect(outcome.denied).toBe(true)
    expect(confirmations[0]?.title).toMatch(/close/i)
    expect(operator.requests.some((request) => request.cmd === 'closeWindow')).toBe(false)
  })

  it('asks before typing into a shell', async () => {
    const operator = makeOperator({
      foreground: () => window({ process: 'WindowsTerminal', title: 'PowerShell' })
    })
    const { service, sessions, confirmations, confirm } = makeService(operator)
    createSession(sessions)
    await service.run(
      { action: 'type', text: 'dir' },
      { taskId: 'task-1', signal: new AbortController().signal, confirm }
    )
    expect(confirmations[0]?.title).toMatch(/terminal/i)
    expect(operator.requests.some((request) => request.cmd === 'typeText')).toBe(true)
  })

  it('asks once per app per task when launching', async () => {
    const { service, sessions, confirmations, confirm } = makeService()
    createSession(sessions)
    await service.run(
      { action: 'launch', app: 'Notepad' },
      { taskId: 'task-1', signal: new AbortController().signal, confirm }
    )
    await service.run(
      { action: 'launch', app: 'notepad' },
      { taskId: 'task-1', signal: new AbortController().signal, confirm }
    )
    expect(confirmations.filter((request) => /launch/i.test(request.title))).toHaveLength(1)
  })

  it('returns a downscaled screenshot image', async () => {
    const { service, sessions, confirm } = makeService()
    createSession(sessions)
    const outcome = await service.run(
      { action: 'screenshot' },
      { taskId: 'task-1', signal: new AbortController().signal, confirm }
    )
    expect(outcome.images?.[0]?.mimeType).toBe('image/jpeg')
    expect(outcome.text).toContain('Screenshot saved')
  })

  it('invokes a UIA element and passes its ref', async () => {
    const operator = makeOperator()
    const { service, sessions, confirm } = makeService(operator)
    createSession(sessions)
    const outcome = await service.run(
      { action: 'invoke', handle: 101, refId: '42.1' },
      { taskId: 'task-1', signal: new AbortController().signal, confirm }
    )
    expect(outcome.text).toContain('42.1')
    const call = operator.requests.find((request) => request.cmd === 'invokeElement')
    expect(call?.args.refId).toBe('42.1')
  })
})
