import { NavLink, useNavigate } from 'react-router-dom'
import {
  FolderKanban,
  Settings,
  TerminalSquare,
  Wrench
} from 'lucide-react'
import clsx from 'clsx'
import { useAppStore } from '../lib/store'

const NAV_ITEMS = [
  { to: '/', label: 'Home', icon: TerminalSquare, index: '01', end: true },
  { to: '/projects', label: 'Projects', icon: FolderKanban, index: '02', end: false },
  { to: '/tools', label: 'Tools', icon: Wrench, index: '03', end: false },
  { to: '/settings', label: 'Settings', icon: Settings, index: '04', end: false }
]

export function Sidebar() {
  const navigate = useNavigate()
  const providers = useAppStore((state) => state.providers)
  const health = useAppStore((state) => state.health)
  const runs = useAppStore((state) => state.runs)
  const system = useAppStore((state) => state.system)

  const activeRuns = Object.values(runs).filter((run) => !run.finished).length
  const provider = providers.find((item) => item.isDefault) ?? providers[0] ?? null
  const degraded = health?.checks.some((check) => check.status === 'error') ?? false

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <span className="sidebar-kicker">// PRIMARY</span>
      </div>

      <nav className="sidebar-nav" aria-label="Primary">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => clsx('nav-item', isActive && 'is-active')}
            >
              <span className="nav-index">{item.index}</span>
              <Icon size={15} strokeWidth={1.7} />
              <span>{item.label}</span>
              {item.to === '/' && activeRuns > 0 ? (
                <span className="nav-badge">{activeRuns}</span>
              ) : null}
            </NavLink>
          )
        })}
      </nav>

      <div className="sidebar-term-note">
        <span className="sidebar-kicker">// CONTEXT</span>
        <p>
          History and memory are available inside the terminal.
        </p>
        <div className="sidebar-term-links">
          <button
            type="button"
            onClick={() => navigate('/', { state: { terminalCommand: '/history' } })}
          >
            /history
          </button>
          <button
            type="button"
            onClick={() => navigate('/', { state: { terminalCommand: '/memory' } })}
          >
            /memory
          </button>
        </div>
      </div>

      <div className="sidebar-footer">
        <div className="sidebar-system">
          <div className="sidebar-system-row">
            <span className="sidebar-system-label">Provider</span>
            <span className="sidebar-system-value">{provider ? provider.name : 'Not configured'}</span>
          </div>
          <div className="sidebar-system-row">
            <span className="sidebar-system-label">Core</span>
            <span className={clsx('sidebar-system-value', degraded && 'is-warn')}>
              {health ? (degraded ? 'Attention' : 'Nominal') : 'Booting'}
            </span>
          </div>
          <div className="sidebar-system-row">
            <span className="sidebar-system-label">Version</span>
            <span className="sidebar-system-value">v{system?.version ?? '1.0.0'}</span>
          </div>
        </div>
        <div className="sidebar-copyright">IGRIS // LOCAL-FIRST</div>
      </div>
    </aside>
  )
}
