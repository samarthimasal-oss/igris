import { NavLink, useNavigate } from 'react-router-dom'
import {
  Activity,
  Bot,
  Cpu,
  FolderKanban,
  History,
  Home,
  MessageSquare,
  Monitor,
  Plus,
  Settings,
  Wrench
} from 'lucide-react'
import clsx from 'clsx'
import { useAppStore } from '../lib/store'

const NAV_GROUPS = [
  {
    label: 'Work',
    items: [
      { to: '/', label: 'Command deck', icon: Home, end: true },
      { to: '/chat', label: 'Conversation', icon: MessageSquare },
      { to: '/projects', label: 'Projects', icon: FolderKanban }
    ]
  },
  {
    label: 'Control',
    items: [
      { to: '/computer', label: 'Computer', icon: Monitor },
      { to: '/models', label: 'AI models', icon: Cpu },
      { to: '/tools', label: 'Toolkit', icon: Wrench }
    ]
  },
  {
    label: 'System',
    items: [
      { to: '/activity', label: 'Activity', icon: Activity },
      { to: '/settings', label: 'Settings', icon: Settings },
      { to: '/history', label: 'History', icon: History }
    ]
  }
]

const ACTIVE_STATUSES = new Set([
  'queued',
  'planning',
  'awaiting_confirmation',
  'running'
])

export function Sidebar() {
  const navigate = useNavigate()
  const tasks = useAppStore((state) => state.tasks)
  const providers = useAppStore((state) => state.providers)
  const companion = useAppStore((state) => state.companion)
  const health = useAppStore((state) => state.health)
  const newConversation = useAppStore((state) => state.newConversation)
  const refreshCompanion = useAppStore((state) => state.refreshCompanion)
  const notify = useAppStore((state) => state.notify)

  const activeTasks = tasks.filter((task) => ACTIVE_STATUSES.has(task.status)).length
  const provider = providers.find((item) => item.isDefault) ?? providers[0] ?? null
  const companionLive = Boolean(companion?.enabled)

  const toggleCompanion = async (): Promise<void> => {
    if (!window.igris) return
    try {
      if (companionLive) await window.igris.companion.hide()
      else await window.igris.companion.show()
      await refreshCompanion()
    } catch (error) {
      notify('error', 'Companion unavailable', error instanceof Error ? error.message : undefined)
    }
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-actions">
        <button
          type="button"
          className="new-chat-button"
          onClick={() => {
            newConversation()
            navigate('/chat')
          }}
        >
          <Plus size={16} />
          <span>New conversation</span>
          <kbd>Ctrl N</kbd>
        </button>
      </div>

      <nav className="sidebar-nav" aria-label="Primary">
        {NAV_GROUPS.map((group) => (
          <div className="nav-group" key={group.label}>
            <span className="nav-group-label">{group.label}</span>
            {group.items.map((item) => {
              const Icon = item.icon
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => clsx('nav-item', isActive && 'is-active')}
                >
                  <Icon size={16} strokeWidth={1.8} />
                  <span>{item.label}</span>
                  {item.to === '/activity' && activeTasks > 0 ? (
                    <span className="nav-badge">{activeTasks}</span>
                  ) : null}
                </NavLink>
              )
            })}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <button type="button" className="companion-chip" onClick={() => void toggleCompanion()}>
          <span className={clsx('companion-chip-orb', companionLive && 'is-live')}>
            <Bot size={15} />
          </span>
          <span className="companion-chip-copy">
            <strong>Companion</strong>
            <small>{companionLive ? companion?.statusText ?? 'On desktop' : 'Hidden'}</small>
          </span>
          <span className={clsx('status-led', companionLive && 'is-live')} />
        </button>

        <div className="sidebar-system">
          <div className="sidebar-system-row">
            <span className="sidebar-system-label">Provider</span>
            <span className="sidebar-system-value">
              {provider ? provider.name : 'Not configured'}
            </span>
          </div>
          <div className="sidebar-system-row">
            <span className="sidebar-system-label">Core</span>
            <span className="sidebar-system-value">
              {health ? (health.checks.some((check) => check.status === 'error') ? 'Attention' : 'Nominal') : 'Booting'}
            </span>
          </div>
        </div>
      </div>
    </aside>
  )
}
