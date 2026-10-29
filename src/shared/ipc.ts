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
} from './types'

export interface IpcContract {
  'system.info': { input: void; output: SystemInfo }
  'system.health': { input: void; output: HealthReport }
  'system.openExternal': { input: { url: string }; output: OkResult }
  'system.copyText': { input: { text: string }; output: OkResult }
  'system.windowControl': {
    input: { action: 'minimize' | 'maximize' | 'close' }
    output: { maximized: boolean }
  }
  'system.revealPath': { input: { path: string }; output: OkResult }

  'settings.get': { input: void; output: Settings }
  'settings.update': { input: DeepPartial<Settings>; output: Settings }
  'settings.export': { input: void; output: ExportResult }
  'settings.clearHistory': {
    input: { conversations: boolean; memories: boolean }
    output: { conversations: number; memories: number }
  }

  'providers.list': { input: void; output: ProviderDto[] }
  'providers.save': { input: ProviderInput; output: ProviderDto }
  'providers.remove': { input: { id: string }; output: OkResult }
  'providers.setDefault': { input: { id: string }; output: ProviderDto[] }
  'providers.setModel': { input: { id: string; model: string }; output: ProviderDto }
  'providers.models': { input: ProviderDraft; output: ModelListResult }
  'providers.test': { input: ProviderDraft; output: ProviderTestResult }

  'conversations.list': { input: { query?: string } | undefined; output: ConversationSummary[] }
  'conversations.get': { input: { id: string }; output: ConversationWithMessages }
  'conversations.create': { input: void; output: Conversation }
  'conversations.rename': { input: { id: string; title: string }; output: Conversation }
  'conversations.delete': { input: { id: string }; output: OkResult }

  'chat.send': { input: ChatSendInput; output: ChatHandle }
  'chat.regenerate': { input: { conversationId: string; messageId: string }; output: ChatHandle }
  'chat.editAndResend': {
    input: { conversationId: string; messageId: string; content: string }
    output: ChatHandle
  }
  'chat.cancel': { input: { runId: string }; output: OkResult }
  'chat.confirm': {
    input: { confirmationId: string; approved: boolean }
    output: OkResult
  }

  'tasks.list': {
    input: { limit?: number; status?: string } | undefined
    output: Task[]
  }
  'tasks.get': { input: { id: string }; output: TaskDetail }
  'tasks.cancel': { input: { id: string }; output: OkResult }
  'tasks.retry': { input: { id: string }; output: ChatHandle }

  'projects.list': { input: void; output: Workspace[] }
  'projects.add': { input: void; output: Workspace | null }
  'projects.remove': { input: { id: string }; output: OkResult }
  'projects.scan': { input: { id: string }; output: ProjectScan }
  'projects.openInExplorer': { input: { id: string }; output: OkResult }
  'projects.touch': { input: { id: string }; output: OkResult }

  'files.preview': {
    input: { workspaceId: string; path: string }
    output: FilePreview
  }
  'files.search': {
    input: { workspaceId: string; query: string }
    output: FileHit[]
  }
  'files.write': {
    input: { workspaceId: string; path: string; content: string }
    output: { path: string; bytes: number; backupPath: string | null }
  }
  'files.create': {
    input: { workspaceId: string; path: string; type: 'file' | 'dir' }
    output: OkResult
  }
  'files.rename': {
    input: { workspaceId: string; from: string; to: string }
    output: OkResult
  }
  'files.delete': { input: { workspaceId: string; path: string }; output: OkResult }
  'files.reveal': { input: { workspaceId: string; path: string }; output: OkResult }

  'computer.apps': { input: void; output: AppInfo[] }
  'computer.launchApp': { input: { appId: string }; output: OkResult }
  'computer.windows': { input: void; output: WindowInfo[] }
  'computer.capture': { input: void; output: ScreenCapture }
  'computer.screenStatus': { input: void; output: ScreenStatus }

  'browser.open': { input: { url?: string }; output: BrowserState }
  'browser.show': { input: void; output: BrowserState }
  'browser.close': { input: void; output: OkResult }
  'browser.navigate': {
    input: { action: 'back' | 'forward' | 'reload' | 'stop' }
    output: BrowserState
  }
  'browser.state': { input: void; output: BrowserState }
  'browser.shellReady': { input: void; output: BrowserState }
  'browser.shellBounds': {
    input: { x: number; y: number; width: number; height: number }
    output: OkResult
  }
  'browser.shellGo': { input: { value: string }; output: BrowserState }

  'tools.list': { input: void; output: ToolInfo[] }

  'memories.list': { input: { query?: string } | undefined; output: MemoryItem[] }
  'memories.add': {
    input: { text: string; kind?: MemoryItem['kind'] }
    output: MemoryItem
  }
  'memories.update': {
    input: { id: string; text: string; kind?: MemoryItem['kind'] }
    output: MemoryItem
  }
  'memories.delete': { input: { id: string }; output: OkResult }

  'diagnostics.logs': { input: { limit?: number } | undefined; output: LogEntry[] }
  'diagnostics.export': { input: void; output: ExportResult }
  'diagnostics.clearLogs': { input: void; output: OkResult }

  'companion.state': { input: void; output: CompanionState }
  'companion.openMain': { input: { route?: string } | undefined; output: OkResult }
  'companion.ask': { input: { text: string }; output: OkResult }
  'companion.hide': { input: void; output: OkResult }
  'companion.show': { input: void; output: OkResult }
  'companion.setAlwaysOnTop': { input: { value: boolean }; output: CompanionState }

  'ui.ready': { input: void; output: OkResult }
  'ui.draft': { input: { text: string }; output: OkResult }
}

export type IpcMethod = keyof IpcContract

export interface DraftEvent {
  text: string
  createdAt: string
}

export interface NavigateEvent {
  route: string
  draft?: string
}

export interface BrowserEvent {
  state: BrowserState
}

export interface CompanionEvent {
  state: CompanionState
}

export interface IgrisBridge {
  platform: string
  system: {
    info: () => Promise<SystemInfo>
    health: () => Promise<HealthReport>
    openExternal: (url: string) => Promise<OkResult>
    copyText: (text: string) => Promise<OkResult>
    windowControl: (
      action: 'minimize' | 'maximize' | 'close'
    ) => Promise<{ maximized: boolean }>
    revealPath: (path: string) => Promise<OkResult>
  }
  settings: {
    get: () => Promise<Settings>
    update: (patch: DeepPartial<Settings>) => Promise<Settings>
    export: () => Promise<ExportResult>
    clearHistory: (options: { conversations: boolean; memories: boolean }) => Promise<{
      conversations: number
      memories: number
    }>
  }
  providers: {
    list: () => Promise<ProviderDto[]>
    save: (input: ProviderInput) => Promise<ProviderDto>
    remove: (id: string) => Promise<OkResult>
    setDefault: (id: string) => Promise<ProviderDto[]>
    setModel: (id: string, model: string) => Promise<ProviderDto>
    models: (draft: ProviderDraft) => Promise<ModelListResult>
    test: (draft: ProviderDraft) => Promise<ProviderTestResult>
  }
  conversations: {
    list: (query?: string) => Promise<ConversationSummary[]>
    get: (id: string) => Promise<ConversationWithMessages>
    create: () => Promise<Conversation>
    rename: (id: string, title: string) => Promise<Conversation>
    delete: (id: string) => Promise<OkResult>
  }
  chat: {
    send: (input: ChatSendInput) => Promise<ChatHandle>
    regenerate: (conversationId: string, messageId: string) => Promise<ChatHandle>
    editAndResend: (
      conversationId: string,
      messageId: string,
      content: string
    ) => Promise<ChatHandle>
    cancel: (runId: string) => Promise<OkResult>
    confirm: (confirmationId: string, approved: boolean) => Promise<OkResult>
    onEvent: (listener: (event: ChatEvent) => void) => () => void
  }
  tasks: {
    list: (options?: { limit?: number; status?: string }) => Promise<Task[]>
    get: (id: string) => Promise<TaskDetail>
    cancel: (id: string) => Promise<OkResult>
    retry: (id: string) => Promise<ChatHandle>
    onEvent: (listener: (event: TaskEvent) => void) => () => void
  }
  projects: {
    list: () => Promise<Workspace[]>
    add: () => Promise<Workspace | null>
    remove: (id: string) => Promise<OkResult>
    scan: (id: string) => Promise<ProjectScan>
    openInExplorer: (id: string) => Promise<OkResult>
    touch: (id: string) => Promise<OkResult>
  }
  files: {
    preview: (workspaceId: string, path: string) => Promise<FilePreview>
    search: (workspaceId: string, query: string) => Promise<FileHit[]>
    write: (workspaceId: string, path: string, content: string) => Promise<{
      path: string
      bytes: number
      backupPath: string | null
    }>
    create: (workspaceId: string, path: string, type: 'file' | 'dir') => Promise<OkResult>
    rename: (workspaceId: string, from: string, to: string) => Promise<OkResult>
    delete: (workspaceId: string, path: string) => Promise<OkResult>
    reveal: (workspaceId: string, path: string) => Promise<OkResult>
  }
  computer: {
    apps: () => Promise<AppInfo[]>
    launchApp: (appId: string) => Promise<OkResult>
    windows: () => Promise<WindowInfo[]>
    capture: () => Promise<ScreenCapture>
    screenStatus: () => Promise<ScreenStatus>
  }
  browser: {
    open: (url?: string) => Promise<BrowserState>
    show: () => Promise<BrowserState>
    close: () => Promise<OkResult>
    navigate: (action: 'back' | 'forward' | 'reload' | 'stop') => Promise<BrowserState>
    state: () => Promise<BrowserState>
    shellReady: () => Promise<BrowserState>
    shellBounds: (bounds: {
      x: number
      y: number
      width: number
      height: number
    }) => Promise<OkResult>
    shellGo: (value: string) => Promise<BrowserState>
    onEvent: (listener: (event: BrowserEvent) => void) => () => void
  }
  tools: {
    list: () => Promise<ToolInfo[]>
  }
  memories: {
    list: (query?: string) => Promise<MemoryItem[]>
    add: (text: string, kind?: MemoryItem['kind']) => Promise<MemoryItem>
    update: (id: string, text: string, kind?: MemoryItem['kind']) => Promise<MemoryItem>
    delete: (id: string) => Promise<OkResult>
  }
  diagnostics: {
    logs: (limit?: number) => Promise<LogEntry[]>
    export: () => Promise<ExportResult>
    clearLogs: () => Promise<OkResult>
  }
  companion: {
    state: () => Promise<CompanionState>
    openMain: (route?: string) => Promise<OkResult>
    ask: (text: string) => Promise<OkResult>
    hide: () => Promise<OkResult>
    show: () => Promise<OkResult>
    setAlwaysOnTop: (value: boolean) => Promise<CompanionState>
    onEvent: (listener: (event: CompanionEvent) => void) => () => void
  }
  ui: {
    ready: () => Promise<OkResult>
    draft: (text: string) => Promise<OkResult>
  }
  events: {
    onDraft: (listener: (event: DraftEvent) => void) => () => void
    onNavigate: (listener: (event: NavigateEvent) => void) => () => void
  }
}

export const IPC_CALL_CHANNEL = 'igris:call'
export const IPC_CHAT_EVENT = 'igris:chat-event'
export const IPC_TASK_EVENT = 'igris:task-event'
export const IPC_BROWSER_EVENT = 'igris:browser-event'
export const IPC_COMPANION_EVENT = 'igris:companion-event'
export const IPC_DRAFT_EVENT = 'igris:draft-event'
export const IPC_NAVIGATE_EVENT = 'igris:navigate-event'

export type WindowRole = 'main' | 'companion' | 'browser'

export const ROLE_METHOD_ALLOWLIST: Record<WindowRole, IpcMethod[] | 'all'> = {
  main: 'all',
  companion: ['companion.state', 'companion.openMain', 'companion.ask', 'companion.hide', 'companion.show'],
  browser: [
    'browser.shellReady',
    'browser.shellBounds',
    'browser.shellGo',
    'browser.navigate',
    'browser.state',
    'system.info',
    'system.copyText',
    'system.windowControl'
  ]
}
