import { app, BrowserWindow, clipboard, dialog, shell } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { existsSync, writeFileSync } from 'node:fs'
import { isAbsolute, relative, resolve as resolvePath } from 'node:path'
import { z } from 'zod'
import {
  IPC_CALL_CHANNEL,
  ROLE_METHOD_ALLOWLIST,
  type IpcContract,
  type IpcMethod,
  type WindowRole
} from '@shared/ipc'
import { PERMISSION_META } from '@shared/defaults'
import type {
  CompanionState,
  DeepPartial,
  ExportResult,
  HealthCheck,
  HealthReport,
  PermissionKey,
  Settings,
  SystemInfo
} from '@shared/types'
import { AppError, normalizeError, serializeError } from './security/errors'
import type { SettingsService } from './services/settingsService'
import type { Logger } from './services/logger'
import type { ProviderService } from './services/providerService'
import type { BrowserService } from './services/browserService'
import type { FileService } from './services/fileService'
import type { TerminalService } from './services/terminalService'
import type { AppService } from './services/appService'
import type { ScreenService } from './services/screenService'
import type { InputService } from './services/inputService'
import type { CredentialStore } from './security/credentials'
import type { Database } from './storage/database'
import type {
  ConversationRepository,
  LogRepository,
  MemoryRepository,
  WorkspaceRepository,
  buildExportBundle
} from './storage/repositories'
import type { TaskService } from './tasks/taskService'
import type { ChatEngine } from './ai/chatEngine'
import type { createToolRegistry } from './tools/registry'
import type { MainWindowManager } from './windows/mainWindow'
import type { CompanionManager } from './windows/companionWindow'

export type ToolRegistry = ReturnType<typeof createToolRegistry>

export interface AppContext {
  version: string
  startedAt: string
  userDataPath: string
  roles: Map<number, WindowRole>
  db: Database
  settings: SettingsService
  logger: Logger
  credentials: CredentialStore
  providers: ProviderService
  conversations: ConversationRepository
  memories: MemoryRepository
  workspaces: WorkspaceRepository
  logs: LogRepository
  tasks: TaskService
  chat: ChatEngine
  tools: ToolRegistry
  files: FileService
  terminal: TerminalService
  apps: AppService
  screen: ScreenService
  input: InputService
  browser: BrowserService
  mainWindow: MainWindowManager
  companion: CompanionManager
  exportBundle: typeof buildExportBundle
}

export interface IpcEnvelope {
  ok: boolean
  data?: unknown
  error?: { code: string; message: string; retryable: boolean }
}

type Handler = (payload: unknown, event: IpcMainInvokeEvent) => unknown | Promise<unknown>

interface ErrorEnvelope {
  ok: false
  error: { code: string; message: string; retryable: boolean }
}

const id = z.string().min(1).max(120)
const shortText = z.string().max(500)
const optionalId = id.optional()
const permissionKeys = [
  'filesystem',
  'fileWrite',
  'projectWrite',
  'terminal',
  'appLaunch',
  'browser',
  'screen',
  'inputControl'
] as const

const settingsPatchSchema = z
  .object({
    appearance: z
      .object({
        accent: z.enum(['azure', 'violet', 'silver']).optional(),
        reducedMotion: z.boolean().optional(),
        animationIntensity: z.enum(['calm', 'balanced', 'lively']).optional(),
        quality: z.enum(['low', 'medium', 'high']).optional(),
        show3d: z.boolean().optional()
      })
      .optional(),
    desktop: z
      .object({
        companionEnabled: z.boolean().optional(),
        companionAlwaysOnTop: z.boolean().optional(),
        launchAtStartup: z.boolean().optional(),
        closeToTray: z.boolean().optional(),
        companionPosition: z
          .object({ x: z.number().int(), y: z.number().int() })
          .nullable()
          .optional()
      })
      .optional(),
    permissions: z
      .object(
        Object.fromEntries(permissionKeys.map((key) => [key, z.boolean().optional()])) as Record<
          PermissionKey,
          z.ZodOptional<z.ZodBoolean>
        >
      )
      .optional(),
    privacy: z
      .object({
        diagnostics: z.boolean().optional(),
        retentionDays: z.number().int().min(0).max(3650).optional(),
        saveConversations: z.boolean().optional()
      })
      .optional(),
    ai: z
      .object({
        contextMessages: z.number().int().min(4).max(80).optional(),
        maxToolIterations: z.number().int().min(1).max(12).optional(),
        temperature: z.number().min(0).max(2).optional(),
        streaming: z.boolean().optional(),
        systemInstructions: z.string().max(8000).optional(),
        confirmSensitiveActions: z.boolean().optional()
      })
      .optional(),
    onboardingComplete: z.boolean().optional()
  })
  .strip()

const providerKindSchema = z.enum([
  'openai',
  'anthropic',
  'gemini',
  'opencode',
  'openai-compatible'
])

const providerDraftSchema = z
  .object({
    providerId: optionalId,
    kind: providerKindSchema,
    baseUrl: z.string().max(500).optional(),
    apiKey: z.string().max(2000).optional(),
    model: z.string().max(200).optional()
  })
  .strip()

const schemas: Partial<Record<IpcMethod, z.ZodType>> = {
  'system.openExternal': z.object({ url: z.string().min(4).max(2048) }).strip(),
  'system.copyText': z.object({ text: z.string().max(200_000) }).strip(),
  'system.windowControl': z.object({ action: z.enum(['minimize', 'maximize', 'close']) }).strip(),
  'system.revealPath': z.object({ path: z.string().min(1).max(2048) }).strip(),
  'settings.update': settingsPatchSchema,
  'settings.clearHistory': z
    .object({ conversations: z.boolean(), memories: z.boolean() })
    .strip(),
  'providers.save': z
    .object({
      id: optionalId,
      name: z.string().min(1).max(80),
      kind: providerKindSchema,
      baseUrl: z.string().max(500).optional(),
      apiKey: z.string().max(2000).optional(),
      defaultModel: z.string().max(200).optional(),
      supportsTools: z.boolean().optional()
    })
    .strip(),
  'providers.remove': z.object({ id }).strip(),
  'providers.setDefault': z.object({ id }).strip(),
  'providers.setModel': z.object({ id, model: z.string().min(1).max(200) }).strip(),
  'providers.models': providerDraftSchema,
  'providers.test': providerDraftSchema,
  'conversations.list': z.object({ query: z.string().max(200).optional() }).strip().optional(),
  'conversations.get': z.object({ id }).strip(),
  'conversations.rename': z.object({ id, title: z.string().min(1).max(200) }).strip(),
  'conversations.delete': z.object({ id }).strip(),
  'chat.send': z
    .object({
      conversationId: optionalId.nullable().optional(),
      content: z.string().min(1).max(40_000),
      providerId: optionalId,
      model: z.string().max(200).optional(),
      workspaceId: optionalId.nullable().optional()
    })
    .strip(),
  'chat.regenerate': z.object({ conversationId: id, messageId: id }).strip(),
  'chat.editAndResend': z
    .object({ conversationId: id, messageId: id, content: z.string().min(1).max(40_000) })
    .strip(),
  'chat.cancel': z.object({ runId: id }).strip(),
  'chat.confirm': z.object({ confirmationId: id, approved: z.boolean() }).strip(),
  'tasks.list': z
    .object({ limit: z.number().int().min(1).max(300).optional(), status: z.string().max(30).optional() })
    .strip()
    .optional(),
  'tasks.get': z.object({ id }).strip(),
  'tasks.cancel': z.object({ id }).strip(),
  'tasks.retry': z.object({ id }).strip(),
  'projects.remove': z.object({ id }).strip(),
  'projects.scan': z.object({ id }).strip(),
  'projects.openInExplorer': z.object({ id }).strip(),
  'projects.touch': z.object({ id }).strip(),
  'files.preview': z.object({ workspaceId: id, path: shortText.max(500) }).strip(),
  'files.search': z.object({ workspaceId: id, query: z.string().min(1).max(200) }).strip(),
  'files.write': z
    .object({ workspaceId: id, path: shortText.max(500), content: z.string().max(5_000_000) })
    .strip(),
  'files.create': z
    .object({ workspaceId: id, path: shortText.max(500), type: z.enum(['file', 'dir']) })
    .strip(),
  'files.rename': z.object({ workspaceId: id, from: shortText.max(500), to: shortText.max(500) }).strip(),
  'files.delete': z.object({ workspaceId: id, path: shortText.max(500) }).strip(),
  'files.reveal': z.object({ workspaceId: id, path: shortText.max(500) }).strip(),
  'computer.launchApp': z.object({ appId: z.string().min(1).max(60) }).strip(),
  'browser.open': z.object({ url: z.string().max(2000).optional() }).strip().optional(),
  'browser.navigate': z.object({ action: z.enum(['back', 'forward', 'reload', 'stop']) }).strip(),
  'browser.shellBounds': z
    .object({
      x: z.number().min(0).max(20_000),
      y: z.number().min(0).max(20_000),
      width: z.number().min(0).max(20_000),
      height: z.number().min(0).max(20_000)
    })
    .strip(),
  'browser.shellGo': z.object({ value: z.string().max(2000) }).strip(),
  'memories.list': z.object({ query: z.string().max(200).optional() }).strip().optional(),
  'memories.add': z
    .object({ text: z.string().min(3).max(4000), kind: z.enum(['fact', 'preference', 'instruction']).optional() })
    .strip(),
  'memories.update': z
    .object({
      id,
      text: z.string().min(3).max(4000),
      kind: z.enum(['fact', 'preference', 'instruction']).optional()
    })
    .strip(),
  'memories.delete': z.object({ id }).strip(),
  'diagnostics.logs': z.object({ limit: z.number().int().min(1).max(1000).optional() }).strip().optional(),
  'companion.openMain': z.object({ route: z.string().max(300).optional() }).strip().optional(),
  'companion.ask': z.object({ text: z.string().min(1).max(4000) }).strip(),
  'companion.setAlwaysOnTop': z.object({ value: z.boolean() }).strip(),
  'ui.draft': z.object({ text: z.string().max(40_000) }).strip()
}

function validate(method: IpcMethod, payload: unknown): unknown {
  const schema = schemas[method]
  if (!schema) return payload ?? undefined
  const result = schema.safeParse(payload)
  if (!result.success) {
    const issue = result.error.issues[0]
    const path = issue?.path.join('.') || 'input'
    throw new AppError('VALIDATION', `Invalid ${path}: ${issue?.message ?? 'unexpected value'}.`)
  }
  return result.data
}

function requirePermission(ctx: AppContext, key: PermissionKey): void {
  if (!ctx.settings.get().permissions[key]) {
    throw new AppError(
      'PERMISSION',
      `${PERMISSION_META[key].label} is disabled. Enable it in Settings → Permissions first.`
    )
  }
}

function ensureInsideRoots(roots: string[], candidate: string): boolean {
  const absolute = resolvePath(candidate)
  return roots.some((root) => {
    const rel = relative(resolvePath(root), absolute)
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
  })
}

function saveDialogFor(ctx: AppContext, options: Electron.SaveDialogOptions): Promise<Electron.SaveDialogReturnValue> {
  const parent = ctx.mainWindow.getWindow()
  return parent ? dialog.showSaveDialog(parent, options) : dialog.showSaveDialog(options)
}

function openFolderDialog(ctx: AppContext): Promise<Electron.OpenDialogReturnValue> {
  const parent = ctx.mainWindow.getWindow()
  const options: Electron.OpenDialogOptions = {
    title: 'Approve a project folder',
    buttonLabel: 'Approve folder',
    properties: ['openDirectory']
  }
  return parent ? dialog.showOpenDialog(parent, options) : dialog.showOpenDialog(options)
}

function systemInfo(ctx: AppContext): SystemInfo {
  return {
    appName: 'IGRIS',
    version: ctx.version,
    electron: process.versions.electron ?? '—',
    chrome: process.versions.chrome ?? '—',
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    osVersion: `${process.getSystemVersion()} (${process.arch})`,
    userDataPath: ctx.userDataPath,
    isPackaged: app.isPackaged,
    startedAt: ctx.startedAt
  }
}

function healthReport(ctx: AppContext): HealthReport {
  const settings = ctx.settings.get()
  const providers = ctx.providers.list()
  const active = providers.find((provider) => provider.isDefault) ?? providers[0] ?? null
  const enabledPermissions = Object.values(settings.permissions).filter(Boolean).length
  const dbBytes = ctx.db.bytes()
  const uptimeSeconds = Math.max(0, Math.round((Date.now() - Date.parse(ctx.startedAt)) / 1000))
  const checks: HealthCheck[] = [
    {
      id: 'database',
      label: 'Local memory',
      status: dbBytes > 0 ? 'ok' : 'warning',
      detail: dbBytes > 0 ? `${(dbBytes / 1024).toFixed(1)} KB SQLite store` : 'Database is empty.'
    },
    {
      id: 'credentials',
      label: 'Windows credential vault',
      status: ctx.credentials.available() ? 'ok' : 'error',
      detail: ctx.credentials.available()
        ? 'DPAPI encryption is available.'
        : 'DPAPI encryption is unavailable; keys cannot be stored.'
    },
    {
      id: 'provider',
      label: 'Cloud intelligence',
      status: active ? (active.lastTest?.ok === false ? 'warning' : 'ok') : 'warning',
      detail: active
        ? `${active.name}${active.defaultModel ? ` · ${active.defaultModel}` : ' · no model selected'}${
            active.lastTest?.ok === false ? ' · last test failed' : ''
          }`
        : 'No provider configured yet.'
    },
    {
      id: 'permissions',
      label: 'Tool permissions',
      status: enabledPermissions > 0 ? 'ok' : 'warning',
      detail:
        enabledPermissions > 0
          ? `${enabledPermissions} of ${permissionKeys.length} capabilities enabled.`
          : 'All capabilities are off. Enable what you need in Settings.'
    },
    {
      id: 'screen',
      label: 'Screen service',
      status: ctx.screen.status().supported ? 'ok' : 'warning',
      detail: ctx.screen.status().detail
    }
  ]
  return {
    checks,
    providerCount: providers.length,
    activeProvider: active?.name ?? null,
    databaseBytes: dbBytes,
    uptimeSeconds,
    pendingTasks: ctx.tasks.pendingCount(),
    companionOpen: ctx.companion.isOpen(),
    browserOpen: Boolean(ctx.browser.getWindow())
  }
}

function buildHandlers(ctx: AppContext): Record<IpcMethod, Handler> {
  return {
    'system.info': () => systemInfo(ctx),
    'system.health': () => healthReport(ctx),
    'system.openExternal': async (raw) => {
      const input = raw as IpcContract['system.openExternal']['input']
      let url: URL
      try {
        url = new URL(input.url)
      } catch {
        throw new AppError('VALIDATION', 'Enter a valid web address.')
      }
      if (!['https:', 'http:'].includes(url.protocol)) {
        throw new AppError('VALIDATION', 'IGRIS only opens HTTP and HTTPS links.')
      }
      if (url.username || url.password) {
        throw new AppError('VALIDATION', 'Links containing credentials are not allowed.')
      }
      await shell.openExternal(url.toString())
      return { ok: true, message: 'Opened in your default browser.' }
    },
    'system.copyText': (raw) => {
      const input = raw as IpcContract['system.copyText']['input']
      clipboard.writeText(input.text)
      return { ok: true }
    },
    'system.windowControl': (raw, event) => {
      const input = raw as IpcContract['system.windowControl']['input']
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win || win.isDestroyed()) throw new AppError('NOT_FOUND', 'Window is unavailable.')
      if (input.action === 'minimize') win.minimize()
      else if (input.action === 'maximize') {
        if (win.isMaximized()) win.unmaximize()
        else win.maximize()
      } else {
        win.close()
      }
      return { maximized: !win.isDestroyed() && win.isMaximized() }
    },
    'system.revealPath': async (raw) => {
      const input = raw as IpcContract['system.revealPath']['input']
      const roots = [ctx.userDataPath, ...ctx.workspaces.list().map((workspace) => workspace.path)]
      if (!ensureInsideRoots(roots, input.path)) {
        throw new AppError('PERMISSION', 'IGRIS can only reveal files it created or files inside approved projects.')
      }
      shell.showItemInFolder(resolvePath(input.path))
      return { ok: true }
    },

    'settings.get': () => ctx.settings.get(),
    'settings.update': (raw) => ctx.settings.update(raw as DeepPartial<Settings>),
    'settings.export': async (): Promise<ExportResult> => {
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
      const result = await saveDialogFor(ctx, {
        title: 'Export IGRIS data',
        defaultPath: `IGRIS-export-${stamp}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      if (result.canceled || !result.filePath) return { ok: false, message: 'Export cancelled.' }
      const target = result.filePath.endsWith('.json') ? result.filePath : `${result.filePath}.json`
      const bundle = ctx.exportBundle(ctx.db, 'IGRIS', ctx.version)
      writeFileSync(target, JSON.stringify(bundle, null, 2), 'utf8')
      ctx.logger.info('settings', `Exported a local data bundle to ${target}.`)
      return { ok: true, path: target, message: 'Export written. API keys are never included.' }
    },
    'settings.clearHistory': (raw) => {
      const input = raw as IpcContract['settings.clearHistory']['input']
      if (ctx.chat.activeRunIds().length) {
        throw new AppError('CONFIG', 'Stop active responses before clearing history.')
      }
      const conversations = input.conversations ? ctx.conversations.clearAll() : 0
      const memories = input.memories ? ctx.memories.clear() : 0
      ctx.logger.info('settings', `Cleared ${conversations} conversations and ${memories} memories.`)
      return { conversations, memories }
    },

    'providers.list': () => ctx.providers.list(),
    'providers.save': (raw) => ctx.providers.save(raw as IpcContract['providers.save']['input']),
    'providers.remove': (raw) => {
      const input = raw as IpcContract['providers.remove']['input']
      ctx.providers.remove(input.id)
      return { ok: true, message: 'Provider removed.' }
    },
    'providers.setDefault': (raw) => {
      const input = raw as IpcContract['providers.setDefault']['input']
      return ctx.providers.setDefault(input.id)
    },
    'providers.setModel': (raw) => {
      const input = raw as IpcContract['providers.setModel']['input']
      return ctx.providers.setModel(input.id, input.model)
    },
    'providers.models': (raw) => ctx.providers.listModels(raw as IpcContract['providers.models']['input']),
    'providers.test': (raw) => ctx.providers.test(raw as IpcContract['providers.test']['input']),

    'conversations.list': (raw) => {
      const input = (raw ?? {}) as { query?: string }
      return ctx.conversations.list(input.query ?? '')
    },
    'conversations.get': (raw) => {
      const input = raw as IpcContract['conversations.get']['input']
      const conversation = ctx.conversations.get(input.id)
      if (!conversation) throw new AppError('NOT_FOUND', 'That conversation no longer exists.')
      return { conversation, messages: ctx.conversations.getMessages(input.id) }
    },
    'conversations.create': () => ctx.conversations.create(),
    'conversations.rename': (raw) => {
      const input = raw as IpcContract['conversations.rename']['input']
      return ctx.conversations.rename(input.id, input.title)
    },
    'conversations.delete': (raw) => {
      const input = raw as IpcContract['conversations.delete']['input']
      if (ctx.chat.isConversationActive(input.id)) {
        throw new AppError('CONFIG', 'Stop this response before deleting the conversation.')
      }
      ctx.conversations.delete(input.id)
      return { ok: true, message: 'Conversation deleted.' }
    },

    'chat.send': (raw) => ctx.chat.send(raw as IpcContract['chat.send']['input']),
    'chat.regenerate': (raw) => {
      const input = raw as IpcContract['chat.regenerate']['input']
      return ctx.chat.regenerate(input.conversationId, input.messageId)
    },
    'chat.editAndResend': (raw) => {
      const input = raw as IpcContract['chat.editAndResend']['input']
      return ctx.chat.editAndResend(input.conversationId, input.messageId, input.content)
    },
    'chat.cancel': (raw) => {
      const input = raw as IpcContract['chat.cancel']['input']
      return ctx.chat.cancel(input.runId)
        ? { ok: true }
        : { ok: false, message: 'That response has already finished.' }
    },
    'chat.confirm': (raw) => {
      const input = raw as IpcContract['chat.confirm']['input']
      if (!ctx.chat.confirm(input.confirmationId, input.approved)) {
        throw new AppError('NOT_FOUND', 'That confirmation has expired.')
      }
      return { ok: true }
    },

    'tasks.list': (raw) => {
      const input = (raw ?? {}) as { limit?: number; status?: string }
      return ctx.tasks.list(input.limit ?? 100, input.status)
    },
    'tasks.get': (raw) => ctx.tasks.detail((raw as IpcContract['tasks.get']['input']).id),
    'tasks.cancel': (raw) => {
      const input = raw as IpcContract['tasks.cancel']['input']
      return ctx.chat.cancelTask(input.id)
        ? { ok: true }
        : { ok: false, message: 'That task has already finished.' }
    },
    'tasks.retry': (raw) => ctx.chat.retryTask((raw as IpcContract['tasks.retry']['input']).id),

    'projects.list': () => ctx.workspaces.list(),
    'projects.add': async () => {
      const result = await openFolderDialog(ctx)
      const folder = result.filePaths[0]
      if (result.canceled || !folder) return null
      if (!existsSync(folder)) throw new AppError('FILESYSTEM', 'That folder is no longer available.')
      const name = folder.split(/[\\/]/).filter(Boolean).pop() ?? folder
      const workspace = ctx.workspaces.add(name, folder)
      ctx.logger.info('projects', `Approved project folder ${folder}.`)
      return workspace
    },
    'projects.remove': (raw) => {
      const input = raw as IpcContract['projects.remove']['input']
      ctx.workspaces.remove(input.id)
      return { ok: true, message: 'Project removed. No files were deleted.' }
    },
    'projects.scan': (raw) => {
      requirePermission(ctx, 'filesystem')
      return ctx.files.scan((raw as IpcContract['projects.scan']['input']).id)
    },
    'projects.openInExplorer': async (raw) => {
      const input = raw as IpcContract['projects.openInExplorer']['input']
      const workspace = ctx.workspaces.get(input.id)
      if (!workspace) throw new AppError('NOT_FOUND', 'Project not found.')
      const error = await shell.openPath(workspace.path)
      if (error) throw new AppError('FILESYSTEM', 'Windows could not open that folder.', { internal: error })
      return { ok: true }
    },
    'projects.touch': (raw) => {
      ctx.workspaces.touch((raw as IpcContract['projects.touch']['input']).id)
      return { ok: true }
    },

    'files.preview': (raw) => {
      requirePermission(ctx, 'filesystem')
      const input = raw as IpcContract['files.preview']['input']
      return ctx.files.preview(input.workspaceId, input.path)
    },
    'files.search': (raw) => {
      requirePermission(ctx, 'filesystem')
      const input = raw as IpcContract['files.search']['input']
      return ctx.files.search(input.workspaceId, input.query)
    },
    'files.write': (raw) => {
      requirePermission(ctx, 'fileWrite')
      const input = raw as IpcContract['files.write']['input']
      return ctx.files.write(input.workspaceId, input.path, input.content)
    },
    'files.create': (raw) => {
      requirePermission(ctx, 'fileWrite')
      const input = raw as IpcContract['files.create']['input']
      ctx.files.create(input.workspaceId, input.path, input.type)
      return { ok: true }
    },
    'files.rename': (raw) => {
      requirePermission(ctx, 'fileWrite')
      const input = raw as IpcContract['files.rename']['input']
      ctx.files.rename(input.workspaceId, input.from, input.to)
      return { ok: true }
    },
    'files.delete': async (raw) => {
      requirePermission(ctx, 'fileWrite')
      const input = raw as IpcContract['files.delete']['input']
      await ctx.files.delete(input.workspaceId, input.path)
      return { ok: true, message: 'Moved to the Recycle Bin.' }
    },
    'files.reveal': async (raw) => {
      requirePermission(ctx, 'filesystem')
      const input = raw as IpcContract['files.reveal']['input']
      await ctx.files.reveal(input.workspaceId, input.path)
      return { ok: true }
    },

    'computer.apps': () => ctx.apps.list(),
    'computer.launchApp': async (raw) => {
      requirePermission(ctx, 'appLaunch')
      const input = raw as IpcContract['computer.launchApp']['input']
      const message = await ctx.apps.launch(input.appId)
      return { ok: true, message }
    },
    'computer.windows': () => {
      requirePermission(ctx, 'screen')
      return ctx.apps.listWindows()
    },
    'computer.capture': () => {
      requirePermission(ctx, 'screen')
      return ctx.screen.capture()
    },
    'computer.screenStatus': () => ctx.screen.status(),

    'browser.open': (raw) => {
      const input = (raw ?? {}) as { url?: string }
      return ctx.browser.open(input.url ?? 'https://duckduckgo.com/')
    },
    'browser.show': () => ctx.browser.show(),
    'browser.close': () => {
      ctx.browser.close()
      return { ok: true }
    },
    'browser.navigate': (raw) => ctx.browser.navigate((raw as IpcContract['browser.navigate']['input']).action),
    'browser.state': () => ctx.browser.state(),
    'browser.shellReady': () => ctx.browser.shellReady(),
    'browser.shellBounds': (raw) => {
      const input = raw as IpcContract['browser.shellBounds']['input']
      ctx.browser.shellSetBounds(input)
      return { ok: true }
    },
    'browser.shellGo': (raw) => ctx.browser.shellGo((raw as IpcContract['browser.shellGo']['input']).value),

    'tools.list': () => ctx.tools.listInfo(),

    'memories.list': (raw) => {
      const input = (raw ?? {}) as { query?: string }
      return ctx.memories.list(input.query ?? '')
    },
    'memories.add': (raw) => {
      const input = raw as IpcContract['memories.add']['input']
      return ctx.memories.add(input.text, input.kind)
    },
    'memories.update': (raw) => {
      const input = raw as IpcContract['memories.update']['input']
      return ctx.memories.update(input.id, input.text, input.kind)
    },
    'memories.delete': (raw) => {
      ctx.memories.delete((raw as IpcContract['memories.delete']['input']).id)
      return { ok: true }
    },

    'diagnostics.logs': (raw) => {
      const input = (raw ?? {}) as { limit?: number }
      return ctx.logs.list(input.limit ?? 300)
    },
    'diagnostics.export': async (): Promise<ExportResult> => {
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
      const result = await saveDialogFor(ctx, {
        title: 'Export a diagnostic report',
        defaultPath: `IGRIS-diagnostics-${stamp}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      if (result.canceled || !result.filePath) return { ok: false, message: 'Export cancelled.' }
      const target = result.filePath.endsWith('.json') ? result.filePath : `${result.filePath}.json`
      const report = {
        exportedAt: new Date().toISOString(),
        system: systemInfo(ctx),
        health: healthReport(ctx),
        logs: ctx.logs.list(1000)
      }
      writeFileSync(target, JSON.stringify(report, null, 2), 'utf8')
      return { ok: true, path: target, message: 'Diagnostic report written without API keys.' }
    },
    'diagnostics.clearLogs': () => {
      ctx.logs.clear()
      return { ok: true }
    },

    'companion.state': (): CompanionState => ctx.companion.state(),
    'companion.openMain': (raw) => {
      const input = (raw ?? {}) as { route?: string }
      ctx.mainWindow.show(input.route || '/')
      return { ok: true }
    },
    'companion.ask': (raw) => {
      const input = raw as IpcContract['companion.ask']['input']
      ctx.mainWindow.show('/chat', input.text)
      return { ok: true }
    },
    'companion.hide': () => {
      ctx.companion.hide()
      return { ok: true }
    },
    'companion.show': () => {
      ctx.companion.show()
      return { ok: true }
    },
    'companion.setAlwaysOnTop': (raw) => {
      const input = raw as IpcContract['companion.setAlwaysOnTop']['input']
      ctx.companion.setAlwaysOnTop(input.value)
      return ctx.companion.state()
    },

    'ui.ready': () => {
      ctx.mainWindow.markReady()
      return { ok: true }
    },
    'ui.draft': (raw) => {
      const input = raw as IpcContract['ui.draft']['input']
      ctx.mainWindow.show('/chat', input.text)
      return { ok: true }
    }
  }
}

export function createIpcDispatcher(ctx: AppContext): {
  channel: string
  handler: (event: IpcMainInvokeEvent, method: unknown, payload: unknown) => Promise<IpcEnvelope>
} {
  const handlers = buildHandlers(ctx)
  return {
    channel: IPC_CALL_CHANNEL,
    handler: async (event, methodValue, payload): Promise<IpcEnvelope> => {
      let method: IpcMethod | null = null
      try {
        if (typeof methodValue !== 'string' || !(methodValue in handlers)) {
          throw new AppError('INTERNAL', 'Unknown interface method.')
        }
        method = methodValue as IpcMethod
        const role = ctx.roles.get(event.sender.id)
        if (!role) throw new AppError('PERMISSION', 'This window is not authorized to call IGRIS.')
        const allowed = ROLE_METHOD_ALLOWLIST[role]
        if (allowed !== 'all' && !allowed.includes(method)) {
          throw new AppError('PERMISSION', 'This window is not permitted to use that action.')
        }
        const input = validate(method, payload)
        const data = await handlers[method](input, event)
        return { ok: true, data }
      } catch (error) {
        const normalized = normalizeError(error, 'The action could not be completed.')
        if (method) {
          ctx.logger.warn('ipc', `${method} failed: ${normalized.code} ${normalized.userMessage}`)
        }
        const serialized = serializeError(normalized)
        return {
          ok: false,
          error: { code: serialized.code, message: serialized.message, retryable: serialized.retryable }
        }
      }
    }
  }
}
