import { Component, useEffect, type ErrorInfo, type ReactNode } from 'react'
import {
  HashRouter,
  Navigate,
  Route,
  Routes,
  useNavigate
} from 'react-router-dom'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { useAppStore } from './lib/store'
import { Titlebar } from './components/Titlebar'
import { Sidebar } from './components/Sidebar'
import { StatusBar } from './components/StatusBar'
import { Toasts, ConfirmationPrompt } from './components/Overlays'
import { Onboarding } from './components/Onboarding'
import { HomePage } from './pages/HomePage'
import { ChatPage } from './pages/ChatPage'
import { ProjectsPage } from './pages/ProjectsPage'
import { ComputerPage } from './pages/ComputerPage'
import { ModelsPage } from './pages/ModelsPage'
import { ToolsPage } from './pages/ToolsPage'
import { ActivityPage } from './pages/ActivityPage'
import { HistoryPage } from './pages/HistoryPage'
import { SettingsPage } from './pages/SettingsPage'

function BootScreen() {
  return (
    <div className="boot-screen">
      <div className="boot-orb" aria-hidden>
        <span className="boot-orb-ring" />
        <span className="boot-orb-core" />
      </div>
      <div className="boot-brand">IGRIS</div>
      <div className="boot-caption">Assembling the local core</div>
      <div className="boot-track">
        <span />
      </div>
    </div>
  )
}

function BootError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="boot-screen boot-screen-error">
      <div className="boot-error-icon">
        <AlertTriangle size={22} />
      </div>
      <div className="boot-brand">IGRIS</div>
      <div className="boot-caption">The local core could not finish starting.</div>
      <p className="boot-error-message">{message}</p>
      <button type="button" className="btn btn-primary btn-md" onClick={onRetry}>
        <RefreshCw size={14} />
        <span className="btn-label">Try again</span>
      </button>
    </div>
  )
}

class AppErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[IGRIS] Renderer error:', error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="boot-screen boot-screen-error">
          <div className="boot-error-icon">
            <AlertTriangle size={22} />
          </div>
          <div className="boot-brand">IGRIS</div>
          <div className="boot-caption">The interface encountered an unexpected state.</div>
          <p className="boot-error-message">{this.state.error.message}</p>
          <button
            type="button"
            className="btn btn-primary btn-md"
            onClick={() => window.location.reload()}
          >
            <RefreshCw size={14} />
            <span className="btn-label">Reload interface</span>
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

function MainApp() {
  const navigate = useNavigate()
  const ready = useAppStore((state) => state.ready)
  const booting = useAppStore((state) => state.booting)
  const bootError = useAppStore((state) => state.bootError)
  const settings = useAppStore((state) => state.settings)
  const focusConversationId = useAppStore((state) => state.focusConversationId)
  const bootstrap = useAppStore((state) => state.bootstrap)
  const handleChatEvent = useAppStore((state) => state.handleChatEvent)
  const handleTaskEvent = useAppStore((state) => state.handleTaskEvent)
  const setComposerDraft = useAppStore((state) => state.setComposerDraft)
  const newConversation = useAppStore((state) => state.newConversation)
  const consumeFocus = useAppStore((state) => state.consumeFocus)
  const refreshHealth = useAppStore((state) => state.refreshHealth)

  useEffect(() => {
    const bridge = window.igris
    if (!bridge) {
      void bootstrap()
      return
    }
    const unsubscribers = [
      bridge.chat.onEvent((event) => handleChatEvent(event)),
      bridge.tasks.onEvent(() => handleTaskEvent()),
      bridge.events.onDraft((event) => {
        setComposerDraft(event.text)
        navigate('/chat')
      }),
      bridge.events.onNavigate((event) => {
        if (event.draft) setComposerDraft(event.draft)
        navigate(event.route)
      })
    ]
    void bootstrap()
    void bridge.ui.ready()
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe()
    }
  }, [
    bootstrap,
    handleChatEvent,
    handleTaskEvent,
    navigate,
    setComposerDraft
  ])

  useEffect(() => {
    if (!focusConversationId) return
    const id = consumeFocus()
    if (id) navigate(`/chat/${id}`)
  }, [focusConversationId, consumeFocus, navigate])

  useEffect(() => {
    const root = document.documentElement
    if (!settings) return
    root.dataset.accent = settings.appearance.accent
    root.dataset.motion = settings.appearance.reducedMotion ? 'reduced' : 'full'
    root.dataset.intensity = settings.appearance.animationIntensity
    root.dataset.quality = settings.appearance.quality
  }, [settings])

  useEffect(() => {
    if (!ready) return
    const timer = window.setInterval(() => void refreshHealth(), 60_000)
    return () => window.clearInterval(timer)
  }, [ready, refreshHealth])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!event.ctrlKey || event.altKey) return
      if (event.key.toLowerCase() === 'n') {
        event.preventDefault()
        newConversation()
        navigate('/chat')
      }
      if (event.key === ',') {
        event.preventDefault()
        navigate('/settings')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, newConversation])

  if (!ready || booting) return <BootScreen />
  if (bootError && !settings) {
    return <BootError message={bootError} onRetry={() => void bootstrap()} />
  }

  return (
    <div className="app-shell">
      <Titlebar />
      <div className="app-body">
        <Sidebar />
        <main className="content" id="main-content">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/chat/:conversationId" element={<ChatPage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/computer" element={<ComputerPage />} />
            <Route path="/models" element={<ModelsPage />} />
            <Route path="/tools" element={<ToolsPage />} />
            <Route path="/activity" element={<ActivityPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
      <StatusBar />
      <Toasts />
      <ConfirmationPrompt />
      <Onboarding />
    </div>
  )
}

function Root() {
  return <MainApp />
}

export function App() {
  return (
    <HashRouter>
      <AppErrorBoundary>
        <Root />
      </AppErrorBoundary>
    </HashRouter>
  )
}
