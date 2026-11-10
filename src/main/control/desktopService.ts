import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { AppInfo, ToolImage } from '@shared/types'
import { AppError } from '../security/errors'
import type { ControlSessionService } from './sessionService'
import {
  clipText,
  isCloseChord,
  isShellProcess,
  parseKeyChord,
  windowBlockReason,
  type SelfIdentity
} from './policy'
import type {
  OperatorElement,
  OperatorElements,
  OperatorFocusResult,
  OperatorRect,
  OperatorScreenshot,
  OperatorState,
  OperatorValueResult,
  OperatorWindowInfo
} from './types'

export interface OperatorLike {
  request<T>(cmd: string, args?: Record<string, unknown>, timeoutMs?: number): Promise<T>
}

export interface DesktopConfirmRequest {
  title: string
  description: string
  risk?: 'medium' | 'high'
}

export interface DesktopRunContext {
  taskId: string
  signal: AbortSignal
  confirm: (request: DesktopConfirmRequest) => Promise<boolean>
}

export interface DesktopAppLauncher {
  list(): AppInfo[]
  launch(id: string): Promise<string>
}

export interface DesktopServiceDeps {
  operator: OperatorLike
  sessions: ControlSessionService
  apps: DesktopAppLauncher
  logger: { info(scope: string, message: string): void; warn(scope: string, message: string): void }
  screenshotsDir: string
  /** Encodes a saved PNG to a model-safe image, downscaled by the caller. */
  encodeScreenshot: (path: string) => Promise<ToolImage | null>
  openPath: (path: string) => Promise<string>
  self: SelfIdentity
  startMenuRoots?: string[]
  sleep?: (ms: number) => Promise<void>
}

export interface DesktopActionArgs {
  action: string
  x?: number
  y?: number
  x2?: number
  y2?: number
  button?: 'left' | 'right' | 'middle'
  double?: boolean
  amount?: number
  horizontal?: boolean
  text?: string
  keys?: string | string[]
  window?: string
  handle?: number
  state?: 'minimize' | 'maximize' | 'restore' | 'close'
  app?: string
  refId?: string
  waitMs?: number
}

const MAX_TEXT = 20_000
const MAX_ELEMENTS = 200

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function formatRect(rect: OperatorRect): string {
  return `${rect.x},${rect.y} ${rect.width}x${rect.height}`
}

function formatWindow(window: OperatorWindowInfo | null): string {
  if (!window) return 'No foreground window.'
  const flags = [
    window.foreground ? 'foreground' : null,
    window.minimized ? 'minimized' : null,
    window.maximized ? 'maximized' : null,
    window.elevated ? 'elevated' : null
  ].filter(Boolean)
  return `#${window.handle} "${window.title}" — ${window.process} (pid ${window.pid}) at ${formatRect(
    window.rect
  )}${flags.length ? ` [${flags.join(', ')}]` : ''}`
}

function formatElement(element: OperatorElement): string {
  const details = [
    `${element.refId} ${element.role}`,
    element.name ? `"${element.name}"` : '(no name)',
    element.automationId ? `id=${element.automationId}` : '',
    `@${element.bounds.x},${element.bounds.y} ${element.bounds.width}x${element.bounds.height}`,
    element.enabled ? '' : 'disabled',
    element.offscreen ? 'offscreen' : '',
    element.password ? 'PASSWORD-BLOCKED' : '',
    element.patterns.join(',')
  ].filter(Boolean)
  return details.join(' | ')
}

function toWindowList(value: unknown): OperatorWindowInfo[] {
  return Array.isArray(value) ? (value as OperatorWindowInfo[]) : []
}

function sanitizeText(input: string): string {
  return input.replace(/\0/g, '').slice(0, MAX_TEXT)
}

function normalizeKeyList(keys: string | string[] | undefined): string[] {
  if (Array.isArray(keys)) {
    if (keys.length === 0 || keys.length > 6) {
      throw new AppError('VALIDATION', 'A key chord needs between one and six keys.')
    }
    return keys.flatMap((key) => parseKeyChord(String(key)))
  }
  if (typeof keys === 'string') return parseKeyChord(keys)
  throw new AppError('VALIDATION', 'A key or key chord is required.')
}

/**
 * Executes one desktop action per tool call. Every action is checked against
 * the task's control session and the hard-block policy before touching the OS.
 */
export class DesktopService {
  private readonly launched = new Map<string, Set<string>>()
  private readonly sleep: (ms: number) => Promise<void>

  constructor(private readonly deps: DesktopServiceDeps) {
    this.sleep = deps.sleep ?? defaultSleep
  }

  /** Best-effort release of every key and mouse button the operator may hold. */
  async releaseAll(): Promise<void> {
    try {
      await this.deps.operator.request('releaseAll', {}, 2000)
    } catch {
      // The operator may already be gone; stop() kills it anyway.
    }
  }

  async run(args: DesktopActionArgs, ctx: DesktopRunContext): Promise<{
    text: string
    display?: string
    images?: ToolImage[]
    denied?: boolean
  }> {
    this.deps.sessions.assertActive(ctx.taskId, 'desktop')
    this.cleanupLaunchState()
    this.throwIfAborted(ctx.signal)

    const action = String(args.action ?? '')
    this.deps.sessions.recordAction(ctx.taskId, this.describe(args))

    switch (action) {
      case 'state':
        return this.state()
      case 'windows':
        return this.windows()
      case 'screenshot':
        return this.screenshot(ctx)
      case 'elements':
        return this.elements(args)
      case 'focus':
        return this.focus(args)
      case 'launch':
        return this.launch(args, ctx)
      case 'click':
        return this.click(args, ctx)
      case 'move':
        return this.move(args)
      case 'drag':
        return this.drag(args)
      case 'scroll':
        return this.scroll(args)
      case 'type':
        return this.type(args, ctx)
      case 'key':
        return this.key(args, ctx)
      case 'window':
        return this.windowAction(args, ctx)
      case 'invoke':
        return this.invoke(args)
      case 'set_value':
        return this.setValue(args)
      case 'wait':
        return this.wait(args)
      default:
        throw new AppError('VALIDATION', `Unknown desktop action "${action}".`)
    }
  }

  private describe(args: DesktopActionArgs): string {
    const target = args.window ? ` in "${args.window}"` : ''
    switch (args.action) {
      case 'click':
        return `Click ${args.button ?? 'left'} at ${args.x},${args.y}`
      case 'move':
        return `Move pointer to ${args.x},${args.y}`
      case 'drag':
        return `Drag from ${args.x},${args.y} to ${args.x2},${args.y2}`
      case 'scroll':
        return `Scroll ${args.amount ?? 0} at ${args.x ?? 'cursor'},${args.y ?? ''}`
      case 'type':
        return `Type ${String(args.text ?? '').length} characters${target}`
      case 'key':
        return `Press ${Array.isArray(args.keys) ? args.keys.join('+') : String(args.keys ?? '')}${target}`
      case 'launch':
        return `Launch ${args.app ?? 'an app'}`
      case 'window':
        return `${args.state ?? 'restore'} window${target}`
      case 'elements':
        return `Read UI elements${target}`
      case 'screenshot':
        return 'Capture the screen'
      case 'invoke':
        return `Invoke element ${args.refId ?? ''}${target}`
      case 'set_value':
        return `Set value on element ${args.refId ?? ''}${target}`
      case 'focus':
        return `Focus window${target}`
      default:
        return `Desktop ${args.action}`
    }
  }

  private cleanupLaunchState(): void {
    for (const taskId of this.launched.keys()) {
      if (!this.deps.sessions.stateForTask(taskId)) this.launched.delete(taskId)
    }
  }

  private throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) throw new AppError('CANCELLED', 'The task was cancelled.')
  }

  private async state(): Promise<{ text: string; display?: string }> {
    const state = await this.deps.operator.request<OperatorState>('state')
    const windows = toWindowList(await this.deps.operator.request('listWindows'))
    const lines = [
      `Foreground: ${formatWindow(state.foreground)}`,
      `Cursor: ${state.cursor.x},${state.cursor.y}`,
      `Virtual screen: ${formatRect(state.virtualScreen)}`,
      `Monitors: ${state.monitors
        .map(
          (monitor) =>
            `${monitor.primary ? 'primary ' : ''}${formatRect(monitor)} work ${formatRect(monitor.work)}`
        )
        .join('; ')}`,
      `IGRIS process elevated: ${state.processElevated ? 'yes' : 'no'} (desktop control is unelevated)`,
      `Visible windows (${windows.length}):`,
      ...windows.slice(0, 20).map((window) => `- ${formatWindow(window)}`)
    ]
    return {
      text: clipText(lines.join('\n'), 8000),
      display: state.foreground ? `Foreground: ${state.foreground.title}` : 'Desktop state'
    }
  }

  private async windows(): Promise<{ text: string; display?: string }> {
    const windows = toWindowList(await this.deps.operator.request('listWindows'))
    const lines = windows
      .slice(0, 40)
      .map((window) => formatWindow(window))
    return {
      text: clipText(
        `Visible windows (${windows.length}):\n${lines.join('\n') || '(none)'}`,
        8000
      ),
      display: `${windows.length} visible window${windows.length === 1 ? '' : 's'}`
    }
  }

  private async screenshot(ctx: DesktopRunContext): Promise<{
    text: string
    display?: string
    images?: ToolImage[]
  }> {
    const dir = join(this.deps.screenshotsDir, ctx.taskId)
    mkdirSync(dir, { recursive: true })
    const path = join(dir, `shot-${Date.now()}.png`)
    const shot = await this.deps.operator.request<OperatorScreenshot>(
      'screenshot',
      { path },
      30_000
    )
    if (!existsSync(path) || statSync(path).size === 0) {
      throw new AppError('UNSUPPORTED', 'The screen capture was written but the file is empty.')
    }
    const foreground = await this.deps.operator.request<OperatorWindowInfo | null>('foreground')
    const image = await this.deps.encodeScreenshot(path)
    return {
      text: clipText(
        [
          `Screenshot saved locally: ${shot.path}`,
          `Virtual screen: ${shot.x},${shot.y} ${shot.width}x${shot.height}`,
          `Foreground: ${formatWindow(foreground)}`,
          'Use this image with elements or observed text to verify the next action. Coordinates are physical pixels on the virtual screen.'
        ].join('\n'),
        4000
      ),
      display: 'Screen captured',
      images: image ? [image] : []
    }
  }

  private async elements(args: DesktopActionArgs): Promise<{ text: string; display?: string }> {
    const window = await this.resolveWindow(args, true)
    const snapshot = await this.deps.operator.request<OperatorElements>('getElements', {
      handle: window.handle,
      max: MAX_ELEMENTS,
      depth: 10
    })
    const elements = snapshot.elements ?? []
    const passwordCount = elements.filter((element) => element.password).length
    const lines = [
      `Window: ${formatWindow(snapshot.window ?? window)}`,
      `Elements: ${elements.length}${snapshot.truncated ? ' (truncated at limit)' : ''}`,
      ...elements.map((element) => formatElement(element)),
      passwordCount
        ? `${passwordCount} password field(s) are present and permanently blocked. Ask the user to type the password.`
        : ''
    ].filter(Boolean)
    return {
      text: clipText(lines.join('\n'), 12_000),
      display: `${elements.length} UI element${elements.length === 1 ? '' : 's'}`
    }
  }

  private async focus(args: DesktopActionArgs): Promise<{ text: string }> {
    const window = await this.resolveWindow(args, true)
    const result = await this.deps.operator.request<OperatorFocusResult>('focusWindow', {
      handle: window.handle
    })
    if (!result.focused) {
      throw new AppError(
        'UNSUPPORTED',
        `Windows did not allow IGRIS to focus "${window.title}". Bring it to the front manually and try again.`
      )
    }
    return { text: `Focused: ${formatWindow(result.window)}` }
  }

  private async launch(
    args: DesktopActionArgs,
    ctx: DesktopRunContext
  ): Promise<{ text: string; display?: string; denied?: boolean }> {
    const query = String(args.app ?? '').trim()
    if (!query) throw new AppError('VALIDATION', 'An application name is required.')

    const app = this.deps.apps
      .list()
      .find(
        (candidate) =>
          candidate.id.toLowerCase() === query.toLowerCase() ||
          candidate.name.toLowerCase() === query.toLowerCase()
      )
    let launchKey: string
    let label: string
    let launch: () => Promise<string>

    if (app) {
      if (!app.available) throw new AppError('NOT_FOUND', `${app.name} is not installed.`)
      launchKey = `app:${app.id}`
      label = app.name
      launch = () => this.deps.apps.launch(app.id)
    } else {
      const exact = this.findShortcut(query)
      if (!exact) {
        const candidates = this.shortcutCandidates(query)
        return {
          text: `No exact Start Menu shortcut matches "${query}". No app was launched. Candidates: ${
            candidates.length ? candidates.join(', ') : '(none found)'
          }. Ask the user which one they mean, or use a name from the IGRIS app list.`
        }
      }
      launchKey = `shortcut:${exact.path.toLowerCase()}`
      label = exact.name
      launch = () => this.deps.openPath(exact.path)
    }

    const first = !this.launched.get(ctx.taskId)?.has(launchKey)
    if (first) {
      const approved = await this.gate(ctx, {
        title: `Launch ${label}?`,
        description: `IGRIS will start ${label} for this task. This is the first time it launches this app in the current control session.`,
        risk: 'medium'
      })
      if (!approved) {
        return {
          text: `The user declined to launch ${label}. Do not retry unless they ask.`,
          denied: true
        }
      }
      this.rememberLaunch(ctx.taskId, launchKey)
    }

    const message = await launch()
    await this.sleep(700)
    const window = await this.waitForWindow(label, 5000)
    return {
      text: [
        message,
        window
          ? `Detected window: ${formatWindow(window)}`
          : 'No matching window appeared yet. Take a screenshot or list windows before acting.'
      ].join('\n'),
      display: window ? `Launched ${label}: ${window.title}` : `Launched ${label}`
    }
  }

  private rememberLaunch(taskId: string, key: string): void {
    let set = this.launched.get(taskId)
    if (!set) {
      set = new Set()
      this.launched.set(taskId, set)
    }
    set.add(key)
  }

  private async waitForWindow(name: string, timeoutMs: number): Promise<OperatorWindowInfo | null> {
    const needle = name.toLowerCase().replace(/\.lnk$/, '')
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const windows = toWindowList(await this.deps.operator.request('listWindows'))
      const match = windows.find(
        (window) =>
          window.process.toLowerCase().includes(needle) ||
          window.title.toLowerCase().includes(needle) ||
          needle.includes(window.process.toLowerCase())
      )
      if (match) return match
      await this.sleep(400)
    }
    return null
  }

  private async click(
    args: DesktopActionArgs,
    ctx: DesktopRunContext
  ): Promise<{ text: string; display?: string }> {
    this.requirePoint(args)
    const x = args.x!
    const y = args.y!
    const target = await this.deps.operator.request<OperatorWindowInfo | null>('windowAt', { x, y })
    this.assertWindowAllowed(target, 'click in')
    await this.deps.operator.request('click', {
      x,
      y,
      button: args.button ?? 'left',
      double: Boolean(args.double)
    })
    this.throwIfAborted(ctx.signal)
    await this.sleep(120)
    return {
      text: `Clicked ${args.button ?? 'left'} at ${x},${y} in ${target ? `"${target.title}"` : 'the desktop'}. Take a screenshot or elements snapshot to verify the result.`,
      display: `Click ${x},${y}`
    }
  }

  private async move(args: DesktopActionArgs): Promise<{ text: string }> {
    this.requirePoint(args)
    await this.deps.operator.request('moveMouse', { x: args.x, y: args.y })
    return { text: `Pointer moved to ${args.x},${args.y}.` }
  }

  private async drag(args: DesktopActionArgs): Promise<{ text: string }> {
    this.requirePoint(args)
    if (typeof args.x2 !== 'number' || typeof args.y2 !== 'number') {
      throw new AppError('VALIDATION', 'A drag needs x2 and y2 destination coordinates.')
    }
    const start = await this.deps.operator.request<OperatorWindowInfo | null>('windowAt', {
      x: args.x,
      y: args.y
    })
    this.assertWindowAllowed(start, 'drag in')
    const end = await this.deps.operator.request<OperatorWindowInfo | null>('windowAt', {
      x: args.x2,
      y: args.y2
    })
    if (end && end.handle !== start?.handle) {
      this.assertWindowAllowed(end, 'drag into')
    }
    await this.deps.operator.request('drag', {
      x1: args.x,
      y1: args.y,
      x2: args.x2,
      y2: args.y2,
      button: args.button ?? 'left'
    })
    return {
      text: `Dragged from ${args.x},${args.y} to ${args.x2},${args.y2}. Take a screenshot to verify.`
    }
  }

  private async scroll(args: DesktopActionArgs): Promise<{ text: string }> {
    const amount = typeof args.amount === 'number' ? args.amount : 3
    if (!Number.isInteger(amount) || amount < -50 || amount > 50) {
      throw new AppError('VALIDATION', 'Scroll amount must be between -50 and 50 wheel steps.')
    }
    let x = args.x
    let y = args.y
    if (typeof x !== 'number' || typeof y !== 'number') {
      const cursor = await this.deps.operator.request<{ x: number; y: number }>('cursor')
      x = cursor.x
      y = cursor.y
    }
    const target = await this.deps.operator.request<OperatorWindowInfo | null>('windowAt', { x, y })
    this.assertWindowAllowed(target, 'scroll in')
    await this.deps.operator.request('scroll', {
      x,
      y,
      delta: Math.round(amount) * 120,
      horizontal: Boolean(args.horizontal)
    })
    return {
      text: `Scrolled ${amount} step(s) ${args.horizontal ? 'horizontally' : 'vertically'} at ${x},${y}. Take a screenshot to verify.`
    }
  }

  private async type(
    args: DesktopActionArgs,
    ctx: DesktopRunContext
  ): Promise<{ text: string; display?: string; denied?: boolean }> {
    const text = sanitizeText(String(args.text ?? ''))
    if (!text) throw new AppError('VALIDATION', 'Text to type is required.')
    const target = await this.prepareTypingTarget(args)
    if (isShellProcess(target.process)) {
      const approved = await this.gate(ctx, {
        title: 'Type into a terminal?',
        description: `The active window is "${target.title}" (${target.process}). Typing there can run shell commands outside IGRIS's terminal allowlist. Approve only if you asked for this.`,
        risk: 'high'
      })
      if (!approved) {
        return { text: 'The user declined to type into the terminal. Do not retry.', denied: true }
      }
    }
    await this.deps.operator.request('typeText', { text, intervalMs: 8 })
    await this.sleep(120)
    return {
      text: `Typed ${text.length} character${text.length === 1 ? '' : 's'} into "${target.title}". Verify the result before continuing.`,
      display: `Typed ${text.length} chars`
    }
  }

  private async key(
    args: DesktopActionArgs,
    ctx: DesktopRunContext
  ): Promise<{ text: string; denied?: boolean }> {
    const keys = normalizeKeyList(args.keys)
    const target = await this.prepareTypingTarget(args)
    if (isCloseChord(keys)) {
      const approved = await this.gate(ctx, {
        title: 'Close this window?',
        description: `Alt+F4 will close "${target.title}" (${target.process}). Unsaved work could be lost.`,
        risk: 'high'
      })
      if (!approved) return { text: 'The user declined to close the window.', denied: true }
    }
    if (isShellProcess(target.process)) {
      const approved = await this.gate(ctx, {
        title: 'Send keys to a terminal?',
        description: `The active window is "${target.title}" (${target.process}). Keyboard input there can run shell commands outside IGRIS's terminal allowlist.`,
        risk: 'high'
      })
      if (!approved) {
        return { text: 'The user declined to send keys to the terminal.', denied: true }
      }
    }
    await this.deps.operator.request('keyChord', { keys })
    await this.sleep(120)
    return { text: `Pressed ${keys.join('+')} in "${target.title}".` }
  }

  private async windowAction(
    args: DesktopActionArgs,
    ctx: DesktopRunContext
  ): Promise<{ text: string; denied?: boolean }> {
    const state = args.state
    if (!state || !['minimize', 'maximize', 'restore', 'close'].includes(state)) {
      throw new AppError('VALIDATION', 'Window state must be minimize, maximize, restore, or close.')
    }
    const target = await this.resolveWindow(args, true)
    if (state === 'close') {
      const approved = await this.gate(ctx, {
        title: `Close "${target.title}"?`,
        description: `IGRIS will ask "${target.process}" to close. Unsaved work could be lost.`,
        risk: 'high'
      })
      if (!approved) return { text: 'The user declined to close the window.', denied: true }
      await this.deps.operator.request('closeWindow', { handle: target.handle })
      await this.sleep(400)
      return { text: `Asked "${target.title}" to close. Verify whether it actually closed.` }
    }
    const result = await this.deps.operator.request<{ state: string; window: OperatorWindowInfo }>(
      'showWindow',
      { handle: target.handle, state }
    )
    return { text: `${state}: ${formatWindow(result.window)}` }
  }

  private async invoke(args: DesktopActionArgs): Promise<{ text: string }> {
    const window = await this.resolveWindow(args, true)
    const refId = String(args.refId ?? '').trim()
    if (!refId) throw new AppError('VALIDATION', 'An element refId is required.')
    const result = await this.deps.operator.request<{ invoked: boolean; how: string }>(
      'invokeElement',
      { handle: window.handle, refId }
    )
    return {
      text: `Invoked element ${refId} in "${window.title}" using ${result.how}. Take a fresh snapshot to verify the result.`
    }
  }

  private async setValue(args: DesktopActionArgs): Promise<{ text: string }> {
    const window = await this.resolveWindow(args, true)
    const refId = String(args.refId ?? '').trim()
    const text = sanitizeText(String(args.text ?? ''))
    if (!refId) throw new AppError('VALIDATION', 'An element refId is required.')
    const result = await this.deps.operator.request<OperatorValueResult>('setElementValue', {
      handle: window.handle,
      refId,
      text,
      append: false
    })
    return {
      text: `Set ${refId} in "${window.title}". The field now reports ${JSON.stringify(
        result.value.slice(0, 300)
      )}.`
    }
  }

  private async wait(args: DesktopActionArgs): Promise<{ text: string }> {
    const ms = Math.min(Math.max(0, Math.round(args.waitMs ?? 1000)), 10_000)
    await this.sleep(ms)
    const foreground = await this.deps.operator.request<OperatorWindowInfo | null>('foreground')
    return { text: `Waited ${ms} ms. Foreground: ${formatWindow(foreground)}` }
  }

  private async prepareTypingTarget(args: DesktopActionArgs): Promise<OperatorWindowInfo> {
    let target = await this.resolveWindow(args, false)
    if (!target) target = await this.deps.operator.request<OperatorWindowInfo | null>('foreground')
    this.assertWindowAllowed(target, 'type into')
    if (!target) throw new AppError('NOT_FOUND', 'No foreground window is available.')
    if (args.handle || args.window) {
      const focused = await this.deps.operator.request<OperatorFocusResult>('focusWindow', {
        handle: target.handle
      })
      if (!focused.focused) {
        throw new AppError(
          'UNSUPPORTED',
          `Windows did not allow IGRIS to focus "${target.title}". Ask the user to bring it to the front.`
        )
      }
      target = focused.window
    }
    if (target.minimized) {
      throw new AppError(
        'VALIDATION',
        `"${target.title}" is minimized. Restore or focus it before typing.`
      )
    }
    return target
  }

  private async resolveWindow(
    args: DesktopActionArgs,
    required: true
  ): Promise<OperatorWindowInfo>
  private async resolveWindow(
    args: DesktopActionArgs,
    required: boolean
  ): Promise<OperatorWindowInfo | null>
  private async resolveWindow(
    args: DesktopActionArgs,
    required: boolean
  ): Promise<OperatorWindowInfo | null> {
    if (typeof args.handle === 'number') {
      const window = await this.deps.operator.request<OperatorWindowInfo | null>('windowInfo', {
        handle: args.handle
      })
      if (!window) throw new AppError('NOT_FOUND', 'That window handle is no longer valid.')
      this.assertWindowAllowed(window, 'use')
      return window
    }
    if (args.window) {
      const windows = toWindowList(await this.deps.operator.request('listWindows'))
      const needle = args.window.toLowerCase()
      const exact = windows.filter((window) => window.title.toLowerCase() === needle)
      const partial = windows.filter((window) => window.title.toLowerCase().includes(needle))
      const candidates = exact.length ? exact : partial
      if (!candidates.length) {
        throw new AppError(
          'NOT_FOUND',
          `No visible window matches "${args.window}". Use the windows action to list current windows.`
        )
      }
      const chosen =
        candidates.find((window) => window.foreground) ??
        candidates.sort((a, b) => a.title.length - b.title.length)[0]!
      this.assertWindowAllowed(chosen, 'use')
      return chosen
    }
    const foreground = await this.deps.operator.request<OperatorWindowInfo | null>('foreground')
    if (foreground) this.assertWindowAllowed(foreground, 'use')
    if (!foreground && required) {
      throw new AppError(
        'UNSUPPORTED',
        'No foreground window is available. The desktop may be locked or showing the secure desktop. Ask the user to unlock it.'
      )
    }
    return foreground
  }

  private assertWindowAllowed(window: OperatorWindowInfo | null, verb: string): void {
    if (!window) {
      throw new AppError(
        'UNSUPPORTED',
        `Windows did not identify a usable window to ${verb}. The desktop may be locked or elevated.`
      )
    }
    const reason = windowBlockReason(window, this.deps.self)
    if (reason) throw new AppError('PERMISSION', reason)
  }

  private requirePoint(args: DesktopActionArgs): void {
    if (
      typeof args.x !== 'number' ||
      typeof args.y !== 'number' ||
      !Number.isInteger(args.x) ||
      !Number.isInteger(args.y) ||
      Math.abs(args.x) > 32_000 ||
      Math.abs(args.y) > 32_000
    ) {
      throw new AppError('VALIDATION', 'Integer screen coordinates x and y are required.')
    }
  }

  private async gate(ctx: DesktopRunContext, request: DesktopConfirmRequest): Promise<boolean> {
    this.throwIfAborted(ctx.signal)
    const approved = await ctx.confirm(request)
    this.throwIfAborted(ctx.signal)
    return approved
  }

  private findShortcut(name: string): { name: string; path: string } | null {
    const lowered = name.toLowerCase().replace(/\.lnk$/, '')
    const shortcuts = this.listShortcuts()
    return shortcuts.find((shortcut) => shortcut.name.toLowerCase() === lowered) ?? null
  }

  private shortcutCandidates(name: string): string[] {
    const needle = name.toLowerCase().replace(/\.lnk$/, '')
    return this.listShortcuts()
      .map((shortcut) => {
        const value = shortcut.name.toLowerCase()
        let score = 0
        if (value.includes(needle)) score += 100
        if (needle.includes(value)) score += 50
        for (const token of needle.split(/\s+/).filter(Boolean)) {
          if (value.includes(token)) score += 10
        }
        return { ...shortcut, score }
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.name.length - b.name.length)
      .slice(0, 5)
      .map((entry) => entry.name)
  }

  private listShortcuts(): Array<{ name: string; path: string }> {
    const roots = this.deps.startMenuRoots ?? defaultStartMenuRoots()
    const results: Array<{ name: string; path: string }> = []
    const visit = (directory: string, depth: number): void => {
      if (depth > 6 || results.length > 3000) return
      let entries
      try {
        entries = readdirSync(directory, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        if (results.length > 3000) return
        const path = join(directory, entry.name)
        if (entry.isDirectory()) visit(path, depth + 1)
        else if (entry.isFile() && entry.name.toLowerCase().endsWith('.lnk')) {
          results.push({ name: entry.name.slice(0, -4), path })
        }
      }
    }
    for (const root of roots) {
      if (existsSync(root)) visit(root, 0)
    }
    return results
  }
}

export function defaultStartMenuRoots(): string[] {
  const roots = [
    process.env.APPDATA
      ? join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs')
      : null,
    process.env.ProgramData
      ? join(process.env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs')
      : null
  ]
  return roots.filter((root): root is string => Boolean(root && existsSync(root)))
}

export { formatWindow, formatElement, toWindowList }
