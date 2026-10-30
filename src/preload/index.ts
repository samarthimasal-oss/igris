import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC_BROWSER_EVENT,
  IPC_CALL_CHANNEL,
  IPC_CHAT_EVENT,
  IPC_COMPANION_EVENT,
  IPC_DRAFT_EVENT,
  IPC_NAVIGATE_EVENT,
  IPC_TASK_EVENT,
  type BrowserEvent,
  type CompanionEvent,
  type DraftEvent,
  type IgrisBridge,
  type IpcContract,
  type IpcMethod,
  type NavigateEvent
} from '@shared/ipc'
import type {
  AppInfo,
  BrowserPageText,
  BrowserState,
  ChatEvent,
  ChatHandle,
  ChatMessage,
  ChatSendInput,
  CompanionState,
  Conversation,
  ConversationSummary,
  ConversationWithMessages,
  DeepPartial,
  ExportResult,
  FileHit,
  FilePreview,
  HealthReport,
  LogEntry,
  MemoryItem,
  ModelListResult,
  OkResult,
  ProjectScan,
  ProviderDto,
  ProviderDraft,
  ProviderInput,
  ProviderTestResult,
  ScreenCapture,
  ScreenStatus,
  Settings,
  SystemInfo,
  Task,
  TaskDetail,
  TaskEvent,
  ToolInfo,
  WindowInfo,
  Workspace
} from '@shared/types'

class IgrisBridgeError extends Error {
  readonly code: string
  readonly retryable: boolean

  constructor(message: string, code: string, retryable: boolean) {
    super(message)
    this.name = 'IgrisBridgeError'
    this.code = code
    this.retryable = retryable
  }
}

interface IpcEnvelope {
  ok: boolean
  data?: unknown
  error?: { code: string; message: string; retryable: boolean }
}

function invoke<M extends IpcMethod>(
  method: M,
  payload?: IpcContract[M]['input']
): Promise<IpcContract[M]['output']> {
  return ipcRenderer
    .invoke(IPC_CALL_CHANNEL, method, payload)
    .then((raw: IpcEnvelope) => {
      if (raw && raw.ok) return raw.data as IpcContract[M]['output']
      const error = raw?.error
      throw new IgrisBridgeError(
        error?.message ?? 'The action could not be completed.',
        error?.code ?? 'INTERNAL',
        Boolean(error?.retryable)
      )
    })
    .catch((error: unknown) => {
      if (error instanceof IgrisBridgeError) throw error
      const message = error instanceof Error ? error.message : 'The interface connection failed.'
      throw new IgrisBridgeError(message, 'INTERNAL', false)
    })
}

function subscribe<T>(channel: string, listener: (event: T) => void): () => void {
  const wrapped = (_event: Electron.IpcRendererEvent, payload: T): void => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

const bridge: IgrisBridge = {
  platform: process.platform,
  system: {
    info: () => invoke('system.info'),
    health: () => invoke('system.health'),
    openExternal: (url) => invoke('system.openExternal', { url }),
    copyText: (text) => invoke('system.copyText', { text }),
    windowControl: (action) => invoke('system.windowControl', { action }),
    revealPath: (path) => invoke('system.revealPath', { path })
  },
  settings: {
    get: () => invoke('settings.get'),
    update: (patch: DeepPartial<Settings>) => invoke('settings.update', patch),
    export: () => invoke('settings.export'),
    clearHistory: (options) => invoke('settings.clearHistory', options)
  },
  providers: {
    list: () => invoke('providers.list'),
    save: (input: ProviderInput) => invoke('providers.save', input),
    remove: (id: string) => invoke('providers.remove', { id }),
    setDefault: (id: string) => invoke('providers.setDefault', { id }),
    setModel: (id: string, model: string) => invoke('providers.setModel', { id, model }),
    models: (draft: ProviderDraft) => invoke('providers.models', draft),
    test: (draft: ProviderDraft) => invoke('providers.test', draft)
  },
  conversations: {
    list: (query?: string) => invoke('conversations.list', query === undefined ? undefined : { query }),
    get: (id: string) => invoke('conversations.get', { id }),
    create: () => invoke('conversations.create'),
    rename: (id: string, title: string) => invoke('conversations.rename', { id, title }),
    delete: (id: string) => invoke('conversations.delete', { id })
  },
  chat: {
    send: (input: ChatSendInput) => invoke('chat.send', input),
    regenerate: (conversationId: string, messageId: string) =>
      invoke('chat.regenerate', { conversationId, messageId }),
    editAndResend: (conversationId: string, messageId: string, content: string) =>
      invoke('chat.editAndResend', { conversationId, messageId, content }),
    cancel: (runId: string) => invoke('chat.cancel', { runId }),
    confirm: (confirmationId: string, approved: boolean) =>
      invoke('chat.confirm', { confirmationId, approved }),
    onEvent: (listener: (event: ChatEvent) => void) => subscribe(IPC_CHAT_EVENT, listener)
  },
  tasks: {
    list: (options?: { limit?: number; status?: string }) =>
      invoke('tasks.list', options === undefined ? undefined : options),
    get: (id: string) => invoke('tasks.get', { id }),
    cancel: (id: string) => invoke('tasks.cancel', { id }),
    retry: (id: string) => invoke('tasks.retry', { id }),
    onEvent: (listener: (event: TaskEvent) => void) => subscribe(IPC_TASK_EVENT, listener)
  },
  projects: {
    list: () => invoke('projects.list'),
    add: () => invoke('projects.add'),
    remove: (id: string) => invoke('projects.remove', { id }),
    scan: (id: string) => invoke('projects.scan', { id }),
    openInExplorer: (id: string) => invoke('projects.openInExplorer', { id }),
    touch: (id: string) => invoke('projects.touch', { id })
  },
  files: {
    preview: (workspaceId: string, path: string) => invoke('files.preview', { workspaceId, path }),
    search: (workspaceId: string, query: string) => invoke('files.search', { workspaceId, query }),
    write: (workspaceId: string, path: string, content: string) =>
      invoke('files.write', { workspaceId, path, content }),
    create: (workspaceId: string, path: string, type: 'file' | 'dir') =>
      invoke('files.create', { workspaceId, path, type }),
    rename: (workspaceId: string, from: string, to: string) =>
      invoke('files.rename', { workspaceId, from, to }),
    delete: (workspaceId: string, path: string) => invoke('files.delete', { workspaceId, path }),
    reveal: (workspaceId: string, path: string) => invoke('files.reveal', { workspaceId, path })
  },
  computer: {
    apps: () => invoke('computer.apps'),
    launchApp: (appId: string) => invoke('computer.launchApp', { appId }),
    windows: () => invoke('computer.windows'),
    capture: () => invoke('computer.capture'),
    screenStatus: () => invoke('computer.screenStatus')
  },
  browser: {
    open: (url?: string) => invoke('browser.open', url === undefined ? undefined : { url }),
    show: () => invoke('browser.show'),
    close: () => invoke('browser.close'),
    navigate: (action) => invoke('browser.navigate', { action }),
    state: () => invoke('browser.state'),
    shellReady: () => invoke('browser.shellReady'),
    shellBounds: (bounds) => invoke('browser.shellBounds', bounds),
    shellGo: (value: string) => invoke('browser.shellGo', { value }),
    onEvent: (listener: (event: BrowserEvent) => void) => subscribe(IPC_BROWSER_EVENT, listener)
  },
  tools: {
    list: () => invoke('tools.list')
  },
  memories: {
    list: (query?: string) => invoke('memories.list', query === undefined ? undefined : { query }),
    add: (text: string, kind?: MemoryItem['kind']) => invoke('memories.add', { text, kind }),
    update: (id: string, text: string, kind?: MemoryItem['kind']) =>
      invoke('memories.update', { id, text, kind }),
    delete: (id: string) => invoke('memories.delete', { id })
  },
  diagnostics: {
    logs: (limit?: number) => invoke('diagnostics.logs', limit === undefined ? undefined : { limit }),
    export: () => invoke('diagnostics.export'),
    clearLogs: () => invoke('diagnostics.clearLogs')
  },
  companion: {
    state: () => invoke('companion.state'),
    openMain: (route?: string) => invoke('companion.openMain', route === undefined ? undefined : { route }),
    ask: (text: string) => invoke('companion.ask', { text }),
    hide: () => invoke('companion.hide'),
    show: () => invoke('companion.show'),
    setAlwaysOnTop: (value: boolean) => invoke('companion.setAlwaysOnTop', { value }),
    onEvent: (listener: (event: CompanionEvent) => void) => subscribe(IPC_COMPANION_EVENT, listener)
  },
  mini: {
    restore: () => invoke('mini.restore')
  },
  ui: {
    ready: () => invoke('ui.ready'),
    draft: (text: string) => invoke('ui.draft', { text })
  },
  events: {
    onDraft: (listener: (event: DraftEvent) => void) => subscribe(IPC_DRAFT_EVENT, listener),
    onNavigate: (listener: (event: NavigateEvent) => void) => subscribe(IPC_NAVIGATE_EVENT, listener)
  }
}

contextBridge.exposeInMainWorld('igris', bridge)

// Type-only references keep the generated declarations aligned with the contract.
export type PreloadSurfaces = {
  info: SystemInfo
  health: HealthReport
  settings: Settings
  provider: ProviderDto
  providerTest: ProviderTestResult
  models: ModelListResult
  conversation: Conversation
  conversations: ConversationSummary[]
  conversationDetail: ConversationWithMessages
  chatHandle: ChatHandle
  message: ChatMessage
  task: Task
  taskDetail: TaskDetail
  taskEvent: TaskEvent
  workspace: Workspace
  project: ProjectScan
  preview: FilePreview
  hit: FileHit
  app: AppInfo
  window: WindowInfo
  capture: ScreenCapture
  screen: ScreenStatus
  browser: BrowserState
  page: BrowserPageText
  tool: ToolInfo
  memory: MemoryItem
  log: LogEntry
  companion: CompanionState
  result: OkResult
  exported: ExportResult
}
