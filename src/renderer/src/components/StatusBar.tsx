import { useEffect, useState } from 'react'
import { Database, ShieldCheck } from 'lucide-react'
import { useAppStore } from '../lib/store'
import { formatBytes } from '../lib/format'
import clsx from 'clsx'

const ACTIVE_STATUSES = new Set([
  'queued',
  'planning',
  'awaiting_confirmation',
  'running'
])

export function StatusBar() {
  const providers = useAppStore((state) => state.providers)
  const preferredProviderId = useAppStore((state) => state.preferredProviderId)
  const health = useAppStore((state) => state.health)
  const system = useAppStore((state) => state.system)
  const tasks = useAppStore((state) => state.tasks)
  const [clock, setClock] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const provider =
    providers.find((item) => item.id === preferredProviderId) ??
    providers.find((item) => item.isDefault) ??
    providers[0] ??
    null
  const activeTasks = tasks.filter((task) => ACTIVE_STATUSES.has(task.status)).length
  const degraded = health?.checks.some((check) => check.status === 'error') ?? false

  return (
    <footer className="statusbar">
      <div className="statusbar-left">
        <span className="statusbar-cell">
          <span className={clsx('status-led', degraded ? 'is-error' : 'is-live')} />
          {degraded ? 'Core attention' : 'Core online'}
        </span>
        <span className="statusbar-divider" />
        <span className="statusbar-cell">
          <ShieldCheck size={12} />
          Local-first · DPAPI
        </span>
      </div>
      <div className="statusbar-center">
        {provider ? (
          <>
            <span className="statusbar-provider">{provider.name}</span>
            <span className="statusbar-model">
              {provider.defaultModel || 'Model not selected'}
            </span>
          </>
        ) : (
          <span className="statusbar-model">No AI provider configured</span>
        )}
      </div>
      <div className="statusbar-right">
        {activeTasks > 0 ? (
          <span className="statusbar-cell statusbar-tasks">
            <span className="pulse-dot" />
            {activeTasks} task{activeTasks === 1 ? '' : 's'} active
          </span>
        ) : null}
        {health ? (
          <span className="statusbar-cell">
            <Database size={12} />
            {formatBytes(health.databaseBytes)}
          </span>
        ) : null}
        <span className="statusbar-cell">
          {clock.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
        </span>
        <span className="statusbar-cell statusbar-version">v{system?.version ?? '1.0.0'}</span>
      </div>
    </footer>
  )
}
