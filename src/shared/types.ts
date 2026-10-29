export type ProviderKind = 'openai' | 'anthropic' | 'gemini' | 'openai-compatible'

export type AccentName = 'azure' | 'violet' | 'silver'
export type QualityLevel = 'low' | 'medium' | 'high'
export type AnimationIntensity = 'calm' | 'balanced' | 'lively'

export type PermissionKey =
  | 'filesystem'
  | 'fileWrite'
  | 'projectWrite'
  | 'terminal'
  | 'appLaunch'
  | 'browser'
  | 'screen'
  | 'inputControl'

export interface AppearanceSettings {
  accent: AccentName
  reducedMotion: boolean
  animationIntensity: AnimationIntensity
  quality: QualityLevel
  show3d: boolean
}

export interface DesktopSettings {
  companionEnabled: boolean
  companionAlwaysOnTop: boolean
  launchAtStartup: boolean
  closeToTray: boolean
  companionPosition: { x: number; y: number } | null
}

export type Permissions = Record<PermissionKey, boolean>

export interface PrivacySettings {
  diagnostics: boolean
  retentionDays: number
  saveConversations: boolean
}

export interface AiSettings {
  contextMessages: number
  maxToolIterations: number
  temperature: number
  streaming: boolean
  systemInstructions: string
  confirmSensitiveActions: boolean
}

export interface Settings {
  appearance: AppearanceSettings
  desktop: DesktopSettings
  permissions: Permissions
  privacy: PrivacySettings
  ai: AiSettings
  onboardingComplete: boolean
}

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P]
}

export interface SystemInfo {
  appName: string
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
  arch: string
  osVersion: string
  userDataPath: string
  isPackaged: boolean
  startedAt: string
}

export interface HealthCheck {
  id: string
  label: string
  status: 'ok' | 'warning' | 'error' | 'unknown'
  detail: string
}

export interface HealthReport {
  checks: HealthCheck[]
  providerCount: number
  activeProvider: string | null
  databaseBytes: number
  uptimeSeconds: number
  pendingTasks: number
  companionOpen: boolean
  browserOpen: boolean
}

// ---------------------------------------------------------------- providers

export interface ProviderDto {
  id: string
  name: string
  kind: ProviderKind
  baseUrl: string
  defaultModel: string
  hasKey: boolean
  keyHint: string | null
  isDefault: boolean
  supportsTools: boolean
  lastTest: ProviderTestResult | null
  createdAt: string
  updatedAt: string
}

export interface ProviderInput {
  id?: string
  name: string
  kind: ProviderKind
  baseUrl?: string
  apiKey?: string
  defaultModel?: string
  supportsTools?: boolean
}

export interface ProviderTestResult {
  ok: boolean
  message: string
  at: string
  latencyMs?: number
  models?: string[]
}

export interface ModelListResult {
  supported: boolean
  models: string[]
  message: string
}

export interface ProviderDraft {
  kind: ProviderKind
  baseUrl?: string
  apiKey?: string
  providerId?: string
  model?: string
}

// ------------------------------------------------------------------ chat

export type ChatRole = 'user' | 'assistant' | 'system'

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface ToolExecutionRecord {
  id: string
  name: string
  arguments: Record<string, unknown>
  status: 'requested' | 'awaiting_confirmation' | 'running' | 'completed' | 'failed' | 'denied' | 'cancelled'
  result?: string
  error?: string
  startedAt?: string
  finishedAt?: string
}

export interface MessageMeta {
  providerId?: string
  providerName?: string
  model?: string
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number }
  toolExecutions?: ToolExecutionRecord[]
  error?: string
  cancelled?: boolean
  durationMs?: number
  regeneratedFrom?: string
}

export interface ChatMessage {
  id: string
  conversationId: string
  role: ChatRole
  content: string
  createdAt: string
  meta: MessageMeta | null
}

export interface Conversation {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

export interface ConversationSummary extends Conversation {
  messageCount: number
  lastMessage: string | null
  lastRole: ChatRole | null
}

export interface ConversationWithMessages {
  conversation: Conversation
  messages: ChatMessage[]
}

export interface ChatSendInput {
  conversationId?: string | null
  content: string
  providerId?: string
  model?: string
  workspaceId?: string | null
}

export interface ChatHandle {
  runId: string
  conversationId: string
  taskId: string
}

export interface ConfirmationRequest {
  id: string
  toolName: string
  title: string
  description: string
  risk: 'medium' | 'high'
  argumentsPreview: string
  expiresAt: string
}

export interface ToolEventPayload {
  callId: string
  toolName: string
  title: string
  status: ToolExecutionRecord['status']
  arguments?: Record<string, unknown>
  result?: string
  error?: string
}

export type ChatEvent =
  | {
      type: 'started'
      runId: string
      conversationId: string
      taskId: string
      assistantMessageId: string
      userMessageId: string
      providerName: string
      model: string
    }
  | { type: 'status'; runId: string; status: 'thinking' | 'working' | 'streaming'; detail?: string }
  | { type: 'delta'; runId: string; text: string }
  | { type: 'tool'; runId: string; tool: ToolEventPayload }
  | { type: 'confirmation'; runId: string; request: ConfirmationRequest }
  | { type: 'confirmation_resolved'; runId: string; confirmationId: string; approved: boolean }
  | { type: 'error'; runId: string; message: string; code: string; retryable: boolean }
  | { type: 'done'; runId: string; messageId: string; message: ChatMessage }
  | {
      type: 'failed'
      runId: string
      messageId: string | null
      message: ChatMessage | null
      messageText: string
      code: string
      retryable: boolean
    }
  | { type: 'cancelled'; runId: string; messageId: string | null; message: ChatMessage | null }

// ------------------------------------------------------------------ tasks

export type TaskStatus =
  | 'queued'
  | 'planning'
  | 'awaiting_confirmation'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface Task {
  id: string
  title: string
  kind: 'chat' | 'tool'
  status: TaskStatus
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  error: string | null
  result: string | null
  conversationId: string | null
  runId: string | null
}

export interface TaskStep {
  id: string
  taskId: string
  index: number
  title: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  detail: string | null
  createdAt: string
  finishedAt: string | null
}

export interface ToolRun {
  id: string
  taskId: string
  toolName: string
  status: string
  approval: 'not_required' | 'pending' | 'approved' | 'denied'
  argsJson: string
  result: string | null
  error: string | null
  startedAt: string | null
  finishedAt: string | null
}

export interface TaskDetail {
  task: Task
  steps: TaskStep[]
  toolRuns: ToolRun[]
}

export type TaskEvent = { type: 'changed'; taskId: string }

// ------------------------------------------------------------------ tools

export type ToolCategory = 'files' | 'projects' | 'computer' | 'browser' | 'memory' | 'system'

export interface ToolInfo {
  id: string
  title: string
  description: string
  category: ToolCategory
  risk: 'low' | 'medium' | 'high'
  permission: PermissionKey | null
  requiresConfirmation: boolean
  available: boolean
  availabilityDetail: string
}

// ------------------------------------------------------------------ projects

export interface Workspace {
  id: string
  name: string
  path: string
  createdAt: string
  lastOpenedAt: string | null
  kind: string | null
}

export interface TreeNode {
  name: string
  path: string
  type: 'file' | 'dir'
  children?: TreeNode[]
}

export interface ProjectScan {
  workspace: Workspace
  tree: TreeNode[]
  files: number
  directories: number
  truncated: boolean
  detected: string[]
  entryPoints: string[]
  topLevel: string[]
}

export interface FilePreview {
  path: string
  name: string
  content: string
  size: number
  truncated: boolean
  binary: boolean
  language: string
}

export interface FileHit {
  path: string
  line: number
  preview: string
}

// ------------------------------------------------------------------ computer

export interface AppInfo {
  id: string
  name: string
  description: string
  available: boolean
  source: 'builtin' | 'detected'
}

export interface WindowInfo {
  title: string
  process: string
  processId: number
}

export interface ScreenCapture {
  path: string
  dataUrl: string
  width: number
  height: number
  capturedAt: string
}

export interface BrowserState {
  open: boolean
  visible: boolean
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

export interface BrowserPageText {
  url: string
  title: string
  text: string
  truncated: boolean
}

// ------------------------------------------------------------------ memory

export interface MemoryItem {
  id: string
  text: string
  kind: 'fact' | 'preference' | 'instruction'
  createdAt: string
  updatedAt: string
}

// ------------------------------------------------------------------ diagnostics

export interface LogEntry {
  id: number
  level: 'info' | 'warn' | 'error'
  scope: string
  message: string
  createdAt: string
}

export interface ScreenStatus {
  supported: boolean
  detail: string
}

export interface CompanionState {
  open: boolean
  enabled: boolean
  alwaysOnTop: boolean
  status: 'idle' | 'listening' | 'thinking' | 'working' | 'success' | 'error'
  statusText: string
}

export interface ExportResult {
  ok: boolean
  path?: string
  message: string
}

export interface OkResult {
  ok: boolean
  message?: string
}

export interface Pagination {
  limit?: number
  offset?: number
}
