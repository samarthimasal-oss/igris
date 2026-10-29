import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Brain,
  Cpu,
  FolderKanban,
  Globe2,
  Lock,
  Monitor,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Wrench,
  Files,
  X
} from 'lucide-react'
import { PERMISSION_META } from '@shared/defaults'
import type { ToolCategory, ToolInfo } from '@shared/types'
import { useAppStore } from '../lib/store'
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader
} from '../components/ui'
import clsx from 'clsx'

const CATEGORIES: Array<{ key: ToolCategory | 'all'; label: string; icon: typeof Files }> = [
  { key: 'all', label: 'All tools', icon: Wrench },
  { key: 'files', label: 'Files', icon: Files },
  { key: 'projects', label: 'Projects', icon: FolderKanban },
  { key: 'computer', label: 'Computer', icon: Monitor },
  { key: 'browser', label: 'Browser', icon: Globe2 },
  { key: 'memory', label: 'Memory', icon: Brain },
  { key: 'system', label: 'System', icon: Cpu }
]

const CATEGORY_ICON: Record<ToolCategory, typeof Files> = {
  files: Files,
  projects: FolderKanban,
  computer: Monitor,
  browser: Globe2,
  memory: Brain,
  system: Cpu
}

export function ToolsPage() {
  const navigate = useNavigate()
  const tools = useAppStore((state) => state.tools)
  const settings = useAppStore((state) => state.settings)
  const refreshTools = useAppStore((state) => state.refreshTools)
  const [category, setCategory] = useState<ToolCategory | 'all'>('all')
  const [query, setQuery] = useState('')

  useEffect(() => {
    void refreshTools()
  }, [refreshTools])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return tools.filter((tool) => {
      if (category !== 'all' && tool.category !== category) return false
      if (!needle) return true
      return (
        tool.title.toLowerCase().includes(needle) ||
        tool.description.toLowerCase().includes(needle) ||
        tool.id.toLowerCase().includes(needle)
      )
    })
  }, [tools, category, query])

  const grouped = useMemo(() => {
    const map = new Map<ToolCategory, ToolInfo[]>()
    for (const tool of filtered) {
      const list = map.get(tool.category) ?? []
      list.push(tool)
      map.set(tool.category, list)
    }
    return map
  }, [filtered])

  const available = tools.filter((tool) => tool.available).length
  const locked = tools.filter(
    (tool) => tool.permission && !settings?.permissions[tool.permission]
  ).length

  const enabledPermissionCount = settings
    ? Object.values(settings.permissions).filter(Boolean).length
    : 0

  return (
    <div className="page tools-page">
      <PageHeader
        eyebrow="Capability surface"
        title="Toolkit"
        description="Every capability IGRIS can invoke, with its risk level, permission, and current availability."
        actions={
          <>
            <Button
              variant="ghost"
              icon={<RefreshCw size={15} />}
              onClick={() => void refreshTools()}
            >
              Refresh
            </Button>
            <Button
              variant="primary"
              icon={<ShieldCheck size={15} />}
              onClick={() => navigate('/settings')}
            >
              Manage permissions
            </Button>
          </>
        }
      />

      <div className="tool-summary">
        <div>
          <strong>{tools.length}</strong>
          <span>registered tools</span>
        </div>
        <div>
          <strong>{available}</strong>
          <span>available now</span>
        </div>
        <div>
          <strong>{locked}</strong>
          <span>permission locked</span>
        </div>
        <div>
          <strong>{enabledPermissionCount}</strong>
          <span>capabilities granted</span>
        </div>
      </div>

      <Alert tone="info" title="Tools are called by the assistant">
        This page is a map of what IGRIS can do, not a remote shell. Every invocation is planned
        in a conversation, recorded in Activity, and paused for approval when the risk requires it.
      </Alert>

      <div className="tool-controls">
        <div className="tool-category-tabs">
          {CATEGORIES.map((item) => {
            const Icon = item.icon
            const count =
              item.key === 'all'
                ? tools.length
                : tools.filter((tool) => tool.category === item.key).length
            return (
              <button
                key={item.key}
                type="button"
                className={clsx('tool-category', category === item.key && 'is-active')}
                onClick={() => setCategory(item.key)}
              >
                <Icon size={13} />
                {item.label}
                <span>{count}</span>
              </button>
            )
          })}
        </div>
        <div className="tool-search">
          <Search size={13} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter tools"
            aria-label="Filter tools"
          />
          {query ? (
            <button type="button" aria-label="Clear filter" onClick={() => setQuery('')}>
              <X size={12} />
            </button>
          ) : null}
        </div>
      </div>

      {filtered.length ? (
        <div className="tool-groups">
          {(Object.keys(CATEGORY_ICON) as ToolCategory[]).map((key) => {
            const group = grouped.get(key)
            if (!group?.length) return null
            const Icon = CATEGORY_ICON[key]
            return (
              <section key={key} className="tool-group">
                <div className="tool-group-head">
                  <span className="tool-group-icon"><Icon size={14} /></span>
                  <h2>{CATEGORIES.find((item) => item.key === key)?.label}</h2>
                  <span>{group.length}</span>
                </div>
                <div className="tool-grid">
                  {group.map((tool) => {
                    const permissionOn = tool.permission
                      ? Boolean(settings?.permissions[tool.permission])
                      : true
                    return (
                      <Card key={tool.id} className={clsx('tool-card', !tool.available && 'is-unavailable')}>
                        <div className="tool-card-head">
                          <span className="tool-card-icon"><Icon size={16} /></span>
                          <div className="tool-card-title">
                            <h3>{tool.title}</h3>
                            <code>{tool.id}</code>
                          </div>
                          <Badge
                            tone={
                              tool.risk === 'high'
                                ? 'danger'
                                : tool.risk === 'medium'
                                  ? 'warning'
                                  : 'neutral'
                            }
                          >
                            {tool.risk} risk
                          </Badge>
                        </div>
                        <p className="tool-card-description">{tool.description}</p>
                        <div className="tool-card-badges">
                          {tool.permission ? (
                            <Badge tone={permissionOn ? 'success' : 'warning'} dot>
                              {permissionOn ? 'Permission granted' : 'Permission required'}
                            </Badge>
                          ) : (
                            <Badge tone="success" dot>No permission needed</Badge>
                          )}
                          {tool.requiresConfirmation ? (
                            <Badge tone="warning">
                              <ShieldAlert size={11} /> Confirmation
                            </Badge>
                          ) : null}
                          <Badge tone={tool.available ? 'neutral' : 'danger'} dot>
                            {tool.available ? 'Ready' : 'Unavailable'}
                          </Badge>
                        </div>
                        <div className="tool-card-foot">
                          <span className={clsx('tool-availability', !tool.available && 'is-blocked')}>
                            {tool.available ? (
                              <ShieldCheck size={12} />
                            ) : (
                              <Lock size={12} />
                            )}
                            {tool.availabilityDetail}
                          </span>
                          {tool.permission && !permissionOn ? (
                            <button
                              type="button"
                              className="link-button"
                              onClick={() => navigate('/settings')}
                            >
                              Enable {PERMISSION_META[tool.permission].label.toLowerCase()}
                            </button>
                          ) : null}
                        </div>
                      </Card>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={Sparkles}
            title="No tools match this filter"
            description="Try a different category or clear the search."
            action={
              <Button variant="default" onClick={() => { setQuery(''); setCategory('all') }}>
                Clear filters
              </Button>
            }
          />
        </Card>
      )}
    </div>
  )
}
