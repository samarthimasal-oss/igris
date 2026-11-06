import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AppWindow,
  Brain,
  Code2,
  Cpu,
  Files,
  FolderKanban,
  Globe2,
  Lock,
  Mic,
  Monitor,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Wrench,
  X
} from 'lucide-react'
import { PERMISSION_META } from '@shared/defaults'
import type { ToolInfo } from '@shared/types'
import { useAppStore } from '../lib/store'
import {
  CAPABILITY_GROUPS,
  capabilityPermissionOn,
  toolsForCapability,
  type CapabilityDefinition
} from '../lib/capabilities'
import { Alert, Button, EmptyState, PageHeader } from '../components/ui'
import clsx from 'clsx'

const CAPABILITY_ICON: Record<string, typeof Files> = {
  projects: FolderKanban,
  files: Files,
  coding: Code2,
  terminal: Terminal,
  apps: AppWindow,
  screen: Monitor,
  browser: Globe2,
  voice: Mic,
  memory: Brain,
  system: Cpu
}

const RISK_TONE = {
  low: 'is-ok',
  medium: 'is-warn',
  high: 'is-danger'
} as const

export function ToolsPage() {
  const navigate = useNavigate()
  const tools = useAppStore((state) => state.tools)
  const settings = useAppStore((state) => state.settings)
  const providers = useAppStore((state) => state.providers)
  const refreshTools = useAppStore((state) => state.refreshTools)
  const [group, setGroup] = useState<string>('all')
  const [query, setQuery] = useState('')

  useEffect(() => {
    void refreshTools()
  }, [refreshTools])

  const defaultProvider = providers.find((item) => item.isDefault) ?? providers[0] ?? null
  const permissions = settings?.permissions
  const voiceEnabled = Boolean(permissions?.voice)
  const voiceProviderReady = defaultProvider?.kind === 'gemini'
  const usable = tools.filter((tool) => tool.available).length
  const locked = tools.filter(
    (tool) => tool.permission && !permissions?.[tool.permission]
  ).length
  const grantedPermissions = permissions
    ? Object.values(permissions).filter(Boolean).length
    : 0

  const needle = query.trim().toLowerCase()
  const matches = (tool: ToolInfo): boolean => {
    if (!needle) return true
    return (
      tool.title.toLowerCase().includes(needle) ||
      tool.description.toLowerCase().includes(needle) ||
      tool.id.toLowerCase().includes(needle)
    )
  }

  const groups = useMemo(() => {
    return CAPABILITY_GROUPS.map((definition) => {
      const members = toolsForCapability(definition, tools).filter(matches)
      return {
        definition,
        members,
        permissionOn: capabilityPermissionOn(definition, permissions),
        allMembers: toolsForCapability(definition, tools)
      }
    }).filter((entry) => (group === 'all' || entry.definition.key === group) && (
      entry.members.length > 0 || (entry.definition.key === 'voice' && !needle)
    ))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tools, permissions, group, needle])

  const openPermission = (definition: CapabilityDefinition): void => {
    navigate('/settings', { state: { section: 'settings-permissions' } })
  }

  return (
    <div className="page tools-page">
      <PageHeader
        eyebrow="CAPABILITY MAP"
        title="Tools"
        description="Every action IGRIS can invoke, grouped by capability. Tools are planned in a conversation and paused for approval when the risk requires it. This page is not a remote shell."
        actions={
          <>
            <Button
              variant="ghost"
              icon={<RefreshCw size={14} />}
              onClick={() => void refreshTools()}
            >
              Refresh
            </Button>
            <Button
              variant="primary"
              icon={<ShieldCheck size={14} />}
              onClick={() => navigate('/settings', { state: { section: 'settings-permissions' } })}
            >
              Permissions
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
          <strong>{usable}</strong>
          <span>available now</span>
        </div>
        <div>
          <strong>{locked}</strong>
          <span>permission locked</span>
        </div>
        <div>
          <strong>{grantedPermissions}/8</strong>
          <span>capabilities granted</span>
        </div>
      </div>

      <Alert tone="info" title="Invocation always runs through the assistant">
        IGRIS uses an allowlisted runtime. Terminal commands, file writes, app launches and screen
        capture remain behind your permissions and per-call approval.
      </Alert>

      <div className="capability-toolbar">
        <div className="capability-tabs" role="tablist" aria-label="Capability groups">
          <button
            type="button"
            className={clsx('capability-tab', group === 'all' && 'is-active')}
            onClick={() => setGroup('all')}
          >
            All <span>{tools.length}</span>
          </button>
          {CAPABILITY_GROUPS.map((definition) => {
            const count = toolsForCapability(definition, tools).length
            return (
              <button
                key={definition.key}
                type="button"
                className={clsx('capability-tab', group === definition.key && 'is-active')}
                onClick={() => setGroup(definition.key)}
              >
                {definition.short} <span>{count}</span>
              </button>
            )
          })}
        </div>
        <div className="tool-search">
          <Search size={12} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="filter capabilities or tool ids"
            aria-label="Filter tools"
          />
          {query ? (
            <button type="button" aria-label="Clear filter" onClick={() => setQuery('')}>
              <X size={11} />
            </button>
          ) : null}
        </div>
      </div>

      {groups.length ? (
        <div>
          {groups.map(({ definition, members, permissionOn, allMembers }) => {
            const Icon = CAPABILITY_ICON[definition.key] ?? Wrench
            const isVoice = definition.key === 'voice'
            return (
              <section key={definition.key} className="capability-group">
                <header className="capability-group-head">
                  <span className="capability-group-icon">
                    <Icon size={13} />
                  </span>
                  <div>
                    <h2>{definition.label}</h2>
                    <p>{definition.description}</p>
                  </div>
                  <div className="capability-group-meta">
                    <span>
                      {isVoice
                        ? voiceEnabled
                          ? 'microphone enabled'
                          : 'microphone disabled'
                        : `${allMembers.filter((tool) => tool.available).length}/${allMembers.length} ready`}
                    </span>
                    <span
                      className={clsx(
                        'capability-group-state',
                        permissionOn ? 'is-on' : 'is-off'
                      )}
                    >
                      {definition.permissions.length
                        ? permissionOn
                          ? 'permission granted'
                          : 'permission required'
                        : 'no permission needed'}
                    </span>
                    {!permissionOn ? (
                      <button
                        type="button"
                        className="capability-tool-link"
                        onClick={() => openPermission(definition)}
                      >
                        enable <ShieldAlert size={10} />
                      </button>
                    ) : null}
                  </div>
                </header>

                {isVoice ? (
                  <div className="capability-tools">
                    <article className={clsx('capability-tool', !voiceEnabled && 'is-locked')}>
                      <div className="capability-tool-head">
                        <h3>Voice transcription</h3>
                        <code>voice.transcribe</code>
                      </div>
                      <p>
                        Records microphone audio and transcribes it through the default Gemini
                        provider. Audio is sent only for the transcription request.
                      </p>
                      <div className="capability-tool-meta">
                        <span className={clsx('capability-pill', voiceEnabled ? 'is-ok' : 'is-warn')}>
                          <Mic size={9} />
                          {voiceEnabled ? 'permission granted' : 'permission required'}
                        </span>
                        <span
                          className={clsx(
                            'capability-pill',
                            voiceProviderReady ? 'is-ok' : 'is-danger'
                          )}
                        >
                          {voiceProviderReady ? 'gemini ready' : 'gemini required'}
                        </span>
                        <button
                          type="button"
                          className="capability-tool-link"
                          onClick={() => navigate('/settings', { state: { section: 'settings-voice' } })}
                        >
                          configure voice
                        </button>
                      </div>
                    </article>
                  </div>
                ) : (
                  <div className="capability-tools">
                    {members.map((tool) => {
                      const toolPermissionOn = tool.permission
                        ? Boolean(permissions?.[tool.permission])
                        : true
                      return (
                        <article
                          key={tool.id}
                          className={clsx('capability-tool', !tool.available && 'is-locked')}
                        >
                          <div className="capability-tool-head">
                            <h3>{tool.title}</h3>
                            <code>{tool.id}</code>
                          </div>
                          <p>{tool.description}</p>
                          <div className="capability-tool-meta">
                            <span className={clsx('capability-pill', RISK_TONE[tool.risk])}>
                              {tool.risk} risk
                            </span>
                            {tool.permission ? (
                              <span
                                className={clsx(
                                  'capability-pill',
                                  toolPermissionOn ? 'is-ok' : 'is-warn'
                                )}
                              >
                                {toolPermissionOn ? <ShieldCheck size={9} /> : <Lock size={9} />}
                                {PERMISSION_META[tool.permission].label.toLowerCase()}
                              </span>
                            ) : (
                              <span className="capability-pill is-ok">no permission</span>
                            )}
                            {tool.requiresConfirmation ? (
                              <span className="capability-pill is-warn">
                                <ShieldAlert size={9} /> approval
                              </span>
                            ) : null}
                            <span
                              className={clsx(
                                'capability-pill',
                                tool.available ? 'is-ok' : 'is-danger'
                              )}
                            >
                              {tool.available ? 'ready' : 'unavailable'}
                            </span>
                            {tool.permission && !toolPermissionOn ? (
                              <button
                                type="button"
                                className="capability-tool-link"
                                onClick={() =>
                                  navigate('/settings', {
                                    state: { section: 'settings-permissions' }
                                  })
                                }
                              >
                                enable
                              </button>
                            ) : null}
                          </div>
                          <div className="capability-tool-meta">
                            <span className="capability-pill">
                              {tool.availabilityDetail}
                            </span>
                          </div>
                        </article>
                      )
                    })}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      ) : (
        <div className="card">
          <EmptyState
            icon={Wrench}
            title="No capability matches this filter"
            description="Try another group, or clear the search term."
            action={
              <Button
                variant="default"
                onClick={() => {
                  setQuery('')
                  setGroup('all')
                }}
              >
                Clear filters
              </Button>
            }
          />
        </div>
      )}
    </div>
  )
}
