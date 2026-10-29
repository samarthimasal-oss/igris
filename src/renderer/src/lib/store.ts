import { create } from 'zustand'
import type {
  BrowserState,
  ChatEvent,
  ChatMessage,
  ChatSendInput,
  CompanionState,
  ConfirmationRequest,
  Conversation,
  ConversationSummary,
  DeepPartial,
  HealthReport,
  Settings,
  Task,
  ToolEventPayload,
  ToolInfo,
  ProviderDto,
  SystemInfo,
  Workspace
} from '@shared/types'
import { errorHint, errorMessage } from './errors'

export type RunStatus =
  | 'starting'
  | 'thinking'
  | 'working'
  | 'streaming'
  | 'done'
  | 'failed'
  | 'cancelled'

export interface ActiveRun {
  runId: string
  taskId: string
  conversationId: string
  assistantMessageId: string
  userText: string
  text: string
  status: RunStatus
  detail: string | null
  providerName: string
  model: string
  tools: ToolEventPayload[]
  error: string | null
  code: string | null
  startedAt: number
  finished: boolean
}

export type ToastKind = 'info' | 'success' | 'warning' | 'error'

export interface ToastItem {
  id: string
  kind: ToastKind
  title: string
  message?: string
}

export interface PendingConfirmation extends ConfirmationRequest {
  runId: string
}

interface AppStore {
  ready: boolean
  booting: boolean
  bootError: string | null
  settings: Settings | null
  providers: ProviderDto[]
  system: SystemInfo | null
  health: HealthReport | null
  companion: CompanionState | null
  browser: BrowserState | null
  tools: ToolInfo[]
  workspaces: Workspace[]
  tasks: Task[]
  conversations: ConversationSummary[]
  activeConversation: Conversation | null
  messages: ChatMessage[]
  loadingConversation: boolean
  runs: Record<string, ActiveRun>
  pendingSend: { content: string; workspaceId: string | null } | null
  confirmations: PendingConfirmation[]
  toasts: ToastItem[]
  composerDraft: string
  onboardingOpen: boolean
  preferredProviderId: string | null
  preferredWorkspaceId: string | null
  focusConversationId: string | null

  bootstrap: () => Promise<void>
  refreshProviders: () => Promise<void>
  refreshConversations: () => Promise<void>
  refreshTasks: () => Promise<void>
  refreshTools: () => Promise<void>
  refreshWorkspaces: () => Promise<void>
  refreshHealth: () => Promise<void>
  refreshCompanion: () => Promise<void>
  refreshBrowser: () => Promise<void>
  updateSettings: (patch: DeepPartial<Settings>) => Promise<Settings>
  completeOnboarding: () => Promise<void>
  openOnboarding: () => void
  closeOnboarding: () => void
  notify: (kind: ToastKind, title: string, message?: string) => void
  dismissToast: (id: string) => void
  handleChatEvent: (event: ChatEvent) => void
  handleTaskEvent: () => void
  loadConversation: (id: string) => Promise<void>
  newConversation: () => void
  deleteConversation: (id: string) => Promise<void>
  renameConversation: (id: string, title: string) => Promise<void>
  sendMessage: (content: string, workspaceId?: string | null) => Promise<void>
  regenerate: (messageId: string) => Promise<void>
  editAndResend: (messageId: string, content: string) => Promise<void>
  cancelRun: (runId: string) => Promise<void>
  answerConfirmation: (id: string, approved: boolean) => Promise<void>
  setComposerDraft: (text: string) => void
  consumeFocus: () => string | null
  setPreferredProvider: (id: string | null) => void
  setPreferredWorkspace: (id: string | null) => void
  setBrowser: (state: BrowserState) => void
  setCompanion: (state: CompanionState) => void
}

let bootPromise: Promise<void> | null = null
let loadToken = 0
let toastCounter = 0

function api(): Window['igris'] | null {
  return typeof window !== 'undefined' && window.igris ? window.igris : null
}

function chooseProvider(providers: ProviderDto[]): ProviderDto | null {
  return providers.find((provider) => provider.isDefault) ?? providers[0] ?? null
}

export const useAppStore = create<AppStore>((set, get) => ({
  ready: false,
  booting: false,
  bootError: null,
  settings: null,
  providers: [],
  system: null,
  health: null,
  companion: null,
  browser: null,
  tools: [],
  workspaces: [],
  tasks: [],
  conversations: [],
  activeConversation: null,
  messages: [],
  loadingConversation: false,
  runs: {},
  pendingSend: null,
  confirmations: [],
  toasts: [],
  composerDraft: '',
  onboardingOpen: false,
  preferredProviderId: null,
  preferredWorkspaceId: null,
  focusConversationId: null,

  bootstrap: async () => {
    if (bootPromise) return bootPromise
    const bridge = api()
    if (!bridge) {
      set({ ready: true, bootError: 'The IGRIS bridge is unavailable. Restart the application.' })
      return
    }
    set({ booting: true, bootError: null })
    bootPromise = (async () => {
      try {
        const [settings, providers, system, health, companion, browser, tools, workspaces, conversations, tasks] =
          await Promise.all([
            bridge.settings.get(),
            bridge.providers.list(),
            bridge.system.info(),
            bridge.system.health(),
            bridge.companion.state(),
            bridge.browser.state(),
            bridge.tools.list(),
            bridge.projects.list(),
            bridge.conversations.list(),
            bridge.tasks.list({ limit: 80 })
          ])
        const preferred = chooseProvider(providers)
        set({
          ready: true,
          booting: false,
          settings,
          providers,
          system,
          health,
          companion,
          browser,
          tools,
          workspaces,
          conversations,
          tasks,
          onboardingOpen: !settings.onboardingComplete,
          preferredProviderId: preferred?.id ?? null,
          preferredWorkspaceId: workspaces[0]?.id ?? null
        })
      } catch (error) {
        bootPromise = null
        set({
          ready: true,
          booting: false,
          bootError: `${errorMessage(error)} ${errorHint(error) ?? ''}`.trim()
        })
      }
    })()
    return bootPromise
  },

  refreshProviders: async () => {
    const bridge = api()
    if (!bridge) return
    try {
      const providers = await bridge.providers.list()
      const current = get().preferredProviderId
      const stillValid = providers.some((provider) => provider.id === current)
      set({
        providers,
        preferredProviderId: stillValid
          ? current
          : (chooseProvider(providers)?.id ?? null)
      })
    } catch (error) {
      get().notify('error', 'Could not refresh providers', errorMessage(error))
    }
  },

  refreshConversations: async () => {
    const bridge = api()
    if (!bridge) return
    try {
      const conversations = await bridge.conversations.list()
      set({ conversations })
    } catch {
      // Conversation refresh is best-effort.
    }
  },

  refreshTasks: async () => {
    const bridge = api()
    if (!bridge) return
    try {
      const tasks = await bridge.tasks.list({ limit: 100 })
      set({ tasks })
      void get().refreshHealth()
    } catch {
      // Task refresh is best-effort.
    }
  },

  refreshTools: async () => {
    const bridge = api()
    if (!bridge) return
    try {
      set({ tools: await bridge.tools.list() })
    } catch {
      // Tool metadata is refreshed on demand.
    }
  },

  refreshWorkspaces: async () => {
    const bridge = api()
    if (!bridge) return
    try {
      set({ workspaces: await bridge.projects.list() })
    } catch (error) {
      get().notify('error', 'Could not refresh projects', errorMessage(error))
    }
  },

  refreshHealth: async () => {
    const bridge = api()
    if (!bridge) return
    try {
      set({ health: await bridge.system.health() })
    } catch {
      // Health is informational.
    }
  },

  refreshCompanion: async () => {
    const bridge = api()
    if (!bridge) return
    try {
      set({ companion: await bridge.companion.state() })
    } catch {
      // The companion may be disabled.
    }
  },

  refreshBrowser: async () => {
    const bridge = api()
    if (!bridge) return
    try {
      set({ browser: await bridge.browser.state() })
    } catch {
      // The browser is optional.
    }
  },

  updateSettings: async (patch) => {
    const bridge = api()
    if (!bridge) throw new Error('The IGRIS bridge is unavailable.')
    const settings = await bridge.settings.update(patch)
    set({ settings })
    if (patch.appearance?.accent || patch.appearance?.reducedMotion || patch.appearance?.quality) {
      // Appearance is applied through the settings object by the shell.
    }
    return settings
  },

  completeOnboarding: async () => {
    try {
      await get().updateSettings({ onboardingComplete: true })
    } catch (error) {
      get().notify('error', 'Could not save onboarding', errorMessage(error))
    }
    set({ onboardingOpen: false })
  },

  openOnboarding: () => set({ onboardingOpen: true }),
  closeOnboarding: () => set({ onboardingOpen: false }),

  notify: (kind, title, message) => {
    toastCounter += 1
    const id = `toast-${Date.now()}-${toastCounter}`
    set((state) => ({ toasts: [...state.toasts.slice(-4), { id, kind, title, message }] }))
    window.setTimeout(() => get().dismissToast(id), kind === 'error' ? 9000 : 5500)
  },

  dismissToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }))
  },

  handleChatEvent: (event) => {
    switch (event.type) {
      case 'started': {
        const pending = get().pendingSend
        const previous = get().runs
        const cleaned: Record<string, ActiveRun> = {}
        for (const [key, run] of Object.entries(previous)) {
          if (run.conversationId !== event.conversationId || !run.finished) cleaned[key] = run
        }
        set((state) => ({
          runs: {
            ...cleaned,
            [event.runId]: {
              runId: event.runId,
              taskId: event.taskId,
              conversationId: event.conversationId,
              assistantMessageId: event.assistantMessageId,
              userText: pending?.content ?? '',
              text: '',
              status: 'starting',
              detail: null,
              providerName: event.providerName,
              model: event.model,
              tools: [],
              error: null,
              code: null,
              startedAt: Date.now(),
              finished: false
            }
          },
          pendingSend: null,
          focusConversationId: event.conversationId,
          messages:
            state.activeConversation?.id === event.conversationId ? state.messages : state.messages
        }))
        void get().refreshConversations()
        if (get().activeConversation?.id === event.conversationId) {
          void get().loadConversation(event.conversationId)
        }
        break
      }
      case 'status': {
        set((state) => {
          const run = state.runs[event.runId]
          if (!run) return state
          return {
            runs: {
              ...state.runs,
              [event.runId]: { ...run, status: event.status, detail: event.detail ?? null }
            }
          }
        })
        break
      }
      case 'delta': {
        set((state) => {
          const run = state.runs[event.runId]
          if (!run) return state
          return {
            runs: {
              ...state.runs,
              [event.runId]: { ...run, text: run.text + event.text, status: 'streaming' }
            }
          }
        })
        break
      }
      case 'tool': {
        set((state) => {
          const run = state.runs[event.runId]
          if (!run) return state
          const tools = [...run.tools]
          const index = tools.findIndex((tool) => tool.callId === event.tool.callId)
          if (index >= 0) tools[index] = event.tool
          else tools.push(event.tool)
          return { runs: { ...state.runs, [event.runId]: { ...run, tools } } }
        })
        break
      }
      case 'confirmation': {
        set((state) => {
          if (state.confirmations.some((item) => item.id === event.request.id)) return state
          return {
            confirmations: [...state.confirmations, { ...event.request, runId: event.runId }]
          }
        })
        break
      }
      case 'confirmation_resolved': {
        set((state) => ({
          confirmations: state.confirmations.filter((item) => item.id !== event.confirmationId)
        }))
        break
      }
      case 'error': {
        set((state) => {
          const run = state.runs[event.runId]
          if (!run) return state
          return {
            runs: {
              ...state.runs,
              [event.runId]: { ...run, error: event.message, code: event.code }
            }
          }
        })
        get().notify('error', 'The response was interrupted', event.message)
        break
      }
      case 'done': {
        set((state) => {
          const run = state.runs[event.runId]
          if (!run) return state
          return {
            runs: {
              ...state.runs,
              [event.runId]: {
                ...run,
                text: event.message.content || run.text,
                status: 'done',
                finished: true,
                error: null
              }
            }
          }
        })
        void get().refreshConversations()
        void get().refreshTasks()
        {
          const conversationId = get().runs[event.runId]?.conversationId
          if (conversationId && get().activeConversation?.id === conversationId) {
            void get().loadConversation(conversationId)
          }
        }
        break
      }
      case 'failed': {
        set((state) => {
          const run = state.runs[event.runId]
          if (!run) return state
          return {
            runs: {
              ...state.runs,
              [event.runId]: {
                ...run,
                status: 'failed',
                finished: true,
                error: event.messageText || run.error || 'The response failed.',
                code: event.code
              }
            }
          }
        })
        get().notify('error', 'The response failed', event.messageText)
        void get().refreshConversations()
        void get().refreshTasks()
        {
          const conversationId = get().runs[event.runId]?.conversationId
          if (conversationId && get().activeConversation?.id === conversationId) {
            void get().loadConversation(conversationId)
          }
        }
        break
      }
      case 'cancelled': {
        set((state) => {
          const run = state.runs[event.runId]
          if (!run) return state
          const text = event.message?.content ?? run.text
          return {
            runs: {
              ...state.runs,
              [event.runId]: {
                ...run,
                text,
                status: 'cancelled',
                finished: true,
                error: null
              }
            }
          }
        })
        void get().refreshTasks()
        {
          const conversationId = get().runs[event.runId]?.conversationId
          if (conversationId && get().activeConversation?.id === conversationId) {
            void get().loadConversation(conversationId)
          }
        }
        break
      }
      default:
        break
    }
  },

  handleTaskEvent: () => {
    void get().refreshTasks()
  },

  loadConversation: async (id) => {
    const bridge = api()
    if (!bridge) return
    const token = ++loadToken
    set({ loadingConversation: true })
    try {
      const data = await bridge.conversations.get(id)
      if (token !== loadToken) return
      set({
        activeConversation: data.conversation,
        messages: data.messages,
        loadingConversation: false
      })
    } catch (error) {
      if (token !== loadToken) return
      set({ loadingConversation: false, activeConversation: null, messages: [] })
      get().notify('error', 'Could not open conversation', errorMessage(error))
    }
  },

  newConversation: () => {
    loadToken += 1
    set({
      activeConversation: null,
      messages: [],
      loadingConversation: false,
      focusConversationId: null,
      pendingSend: null
    })
  },

  deleteConversation: async (id) => {
    const bridge = api()
    if (!bridge) return
    try {
      await bridge.conversations.delete(id)
      if (get().activeConversation?.id === id) {
        set({ activeConversation: null, messages: [] })
      }
      await get().refreshConversations()
      get().notify('success', 'Conversation deleted')
    } catch (error) {
      get().notify('error', 'Could not delete conversation', errorMessage(error))
    }
  },

  renameConversation: async (id, title) => {
    const bridge = api()
    if (!bridge) return
    try {
      const conversation = await bridge.conversations.rename(id, title)
      if (get().activeConversation?.id === id) set({ activeConversation: conversation })
      await get().refreshConversations()
    } catch (error) {
      get().notify('error', 'Could not rename conversation', errorMessage(error))
    }
  },

  sendMessage: async (content, workspaceId) => {
    const bridge = api()
    if (!bridge) return
    const trimmed = content.trim()
    if (!trimmed) return
    const state = get()
    const activeRun = Object.values(state.runs).find(
      (run) => run.conversationId === state.activeConversation?.id && !run.finished
    )
    if (activeRun) {
      state.notify('warning', 'A response is already running', 'Stop it before sending another message.')
      return
    }
    set({
      pendingSend: { content: trimmed, workspaceId: workspaceId ?? null },
      composerDraft: ''
    })
    const input: ChatSendInput = {
      content: trimmed,
      conversationId: state.activeConversation?.id ?? null,
      providerId: state.preferredProviderId ?? undefined,
      workspaceId: workspaceId ?? null
    }
    try {
      await bridge.chat.send(input)
    } catch (error) {
      set({ pendingSend: null })
      get().notify('error', 'Message not sent', `${errorMessage(error)} ${errorHint(error) ?? ''}`.trim())
      throw error
    }
  },

  regenerate: async (messageId) => {
    const bridge = api()
    const conversation = get().activeConversation
    if (!bridge || !conversation) return
    set({ pendingSend: { content: '', workspaceId: get().preferredWorkspaceId } })
    try {
      await bridge.chat.regenerate(conversation.id, messageId)
    } catch (error) {
      set({ pendingSend: null })
      get().notify('error', 'Could not regenerate', errorMessage(error))
    }
  },

  editAndResend: async (messageId, content) => {
    const bridge = api()
    const conversation = get().activeConversation
    if (!bridge || !conversation) return
    set({ pendingSend: { content, workspaceId: get().preferredWorkspaceId } })
    try {
      await bridge.chat.editAndResend(conversation.id, messageId, content)
    } catch (error) {
      set({ pendingSend: null })
      get().notify('error', 'Could not resend the edited message', errorMessage(error))
    }
  },

  cancelRun: async (runId) => {
    const bridge = api()
    if (!bridge) return
    try {
      const result = await bridge.chat.cancel(runId)
      if (!result.ok) get().notify('info', 'Nothing to stop', result.message)
    } catch (error) {
      get().notify('error', 'Could not stop the response', errorMessage(error))
    }
  },

  answerConfirmation: async (id, approved) => {
    const bridge = api()
    if (!bridge) return
    try {
      await bridge.chat.confirm(id, approved)
      set((state) => ({ confirmations: state.confirmations.filter((item) => item.id !== id) }))
    } catch (error) {
      get().notify('error', 'Confirmation failed', errorMessage(error))
    }
  },

  setComposerDraft: (text) => set({ composerDraft: text }),
  consumeFocus: () => {
    const id = get().focusConversationId
    if (id) set({ focusConversationId: null })
    return id
  },
  setPreferredProvider: (id) => set({ preferredProviderId: id }),
  setPreferredWorkspace: (id) => set({ preferredWorkspaceId: id }),
  setBrowser: (state) => set({ browser: state }),
  setCompanion: (state) => set({ companion: state })
}))

export function selectRunsForConversation(
  runs: Record<string, ActiveRun>,
  conversationId: string | null | undefined
): ActiveRun[] {
  if (!conversationId) return []
  return Object.values(runs)
    .filter((run) => run.conversationId === conversationId)
    .sort((a, b) => a.startedAt - b.startedAt)
}

export function selectLatestActiveRun(
  runs: Record<string, ActiveRun>,
  conversationId: string | null | undefined
): ActiveRun | null {
  const filtered = selectRunsForConversation(runs, conversationId).filter((run) => !run.finished)
  return filtered[filtered.length - 1] ?? null
}
