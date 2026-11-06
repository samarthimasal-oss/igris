import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  ArrowUpRight,
  Brain,
  CornerDownLeft,
  FolderKanban,
  History,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Square,
  Wrench
} from 'lucide-react'
import clsx from 'clsx'
import type { ConversationSummary, MemoryItem, Workspace } from '@shared/types'
import { useAppStore, type ActiveRun } from '../lib/store'
import {
  CAPABILITY_GROUPS,
  capabilityPermissionOn,
  toolsForCapability
} from '../lib/capabilities'
import {
  TERMINAL_COMMANDS,
  snapshotRun,
  type CapabilitySummary,
  type RunSnapshot,
  type TerminalBlock,
  type TerminalCommandInfo,
  type TerminalLine
} from '../lib/terminal'
import { MessageText } from '../components/Markdown'
import { ToolTimeline, fromToolEvents } from '../components/ToolTimeline'
import { RobotCompanion, ROBOT_STATE_META, type RobotState } from '../components/RobotCompanion'
import { TerminalWindow } from '../components/terminal/TerminalWindow'
import { TerminalCommand } from '../components/terminal/TerminalCommand'
import { TerminalOutput, TerminalLineGroup } from '../components/terminal/TerminalOutput'
import { TerminalInput } from '../components/terminal/TerminalInput'
import { TerminalStatus } from '../components/terminal/TerminalStatus'
import { formatBytes, greeting, relativeTime, truncate, uptime } from '../lib/format'
import { errorMessage } from '../lib/errors'

const QUICK_COMMANDS = ['/help', '/status', '/projects', '/tools']

function sessionCode(): string {
  return Math.random().toString(16).slice(2, 6).toUpperCase()
}

function statusLabel(run: ActiveRun | RunSnapshot): string {
  switch (run.status) {
    case 'starting':
      return 'LINKING'
    case 'thinking':
      return 'THINKING'
    case 'working':
      return 'WORKING'
    case 'streaming':
      return 'STREAMING'
    case 'failed':
      return 'FAILED'
    case 'cancelled':
      return 'STOPPED'
    default:
      return 'COMPLETE'
  }
}

export function HomePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const settings = useAppStore((state) => state.settings)
  const providers = useAppStore((state) => state.providers)
  const tools = useAppStore((state) => state.tools)
  const workspaces = useAppStore((state) => state.workspaces)
  const conversations = useAppStore((state) => state.conversations)
  const health = useAppStore((state) => state.health)
  const system = useAppStore((state) => state.system)
  const runs = useAppStore((state) => state.runs)
  const confirmations = useAppStore((state) => state.confirmations)
  const preferredProviderId = useAppStore((state) => state.preferredProviderId)
  const preferredWorkspaceId = useAppStore((state) => state.preferredWorkspaceId)
  const sendMessage = useAppStore((state) => state.sendMessage)
  const cancelRun = useAppStore((state) => state.cancelRun)
  const answerConfirmation = useAppStore((state) => state.answerConfirmation)
  const loadConversation = useAppStore((state) => state.loadConversation)
  const newConversation = useAppStore((state) => state.newConversation)
  const refreshConversations = useAppStore((state) => state.refreshConversations)
  const refreshWorkspaces = useAppStore((state) => state.refreshWorkspaces)
  const refreshTools = useAppStore((state) => state.refreshTools)
  const setPreferredWorkspace = useAppStore((state) => state.setPreferredWorkspace)
  const notify = useAppStore((state) => state.notify)

  const [blocks, setBlocks] = useState<TerminalBlock[]>([])
  const [input, setInput] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [sending, setSending] = useState(false)
  const [robotError, setRobotError] = useState(false)
  const [clock, setClock] = useState(() => new Date())
  const inputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const counter = useRef(0)
  const pendingBlock = useRef<{ id: string; text: string; at: number } | null>(null)
  const boundRuns = useRef<Set<string>>(new Set())
  const sendingRef = useRef(false)
  const handledNavigation = useRef<string | null>(null)
  const session = useMemo(sessionCode, [])

  const provider =
    providers.find((item) => item.id === preferredProviderId) ??
    providers.find((item) => item.isDefault) ??
    providers[0] ??
    null
  const providerReady = Boolean(
    provider && (provider.hasKey || provider.kind === 'openai-compatible')
  )
  const permissions = settings?.permissions
  const grantedPermissions = permissions
    ? Object.values(permissions).filter(Boolean).length
    : 0
  const readyTools = tools.filter((tool) => tool.available).length
  const activeRuns = useMemo(
    () => Object.values(runs).filter((run) => !run.finished),
    [runs]
  )
  const activeRun =
    activeRuns.sort((a, b) => b.startedAt - a.startedAt)[0] ?? null
  const busy = sending || activeRuns.length > 0

  const capabilitySummary = useMemo<CapabilitySummary[]>(
    () =>
      CAPABILITY_GROUPS.map((group) => {
        const members = toolsForCapability(group, tools)
        return {
          key: group.key,
          label: group.label,
          permission: group.permissions.join(' + ') || 'none',
          permissionOn: capabilityPermissionOn(group, permissions),
          tools: members.length,
          ready: members.filter((tool) => tool.available).length
        }
      }),
    [tools, permissions]
  )

  const robotState: RobotState = confirmations.length
    ? 'approval'
    : activeRun
      ? activeRun.status === 'thinking'
        ? 'thinking'
        : 'executing'
      : robotError
        ? 'error'
        : input.trim()
          ? 'listening'
          : 'idle'
  const robotMeta = ROBOT_STATE_META[robotState]

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    inputRef.current?.focus()
    void refreshConversations()
  }, [refreshConversations])

  const streamSignal = Object.values(runs)
    .map((run) => `${run.runId}:${run.status}:${run.text.length}:${run.tools.length}`)
    .join('|')

  useEffect(() => {
    const element = scrollRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [blocks, streamSignal])

  useEffect(() => {
    const failed = Object.values(runs).some(
      (run) => run.finished && run.status === 'failed' && Date.now() - run.startedAt < 6000
    )
    if (!failed) return
    setRobotError(true)
    const timer = window.setTimeout(() => setRobotError(false), 7000)
    return () => window.clearTimeout(timer)
  }, [runs])

  // Bind a freshly created run to the terminal block that started it.
  useEffect(() => {
    const pending = pendingBlock.current
    if (!pending) return
    const candidate = Object.values(runs)
      .filter(
        (run) =>
          !boundRuns.current.has(run.runId) &&
          run.userText === pending.text &&
          run.startedAt >= pending.at - 4000
      )
      .sort((a, b) => b.startedAt - a.startedAt)[0]
    if (!candidate) return
    boundRuns.current.add(candidate.runId)
    pendingBlock.current = null
    setBlocks((current) =>
      current.map((block) =>
        block.id === pending.id && block.type === 'run'
          ? { ...block, runId: candidate.runId }
          : block
      )
    )
    void loadConversation(candidate.conversationId)
  }, [runs, loadConversation])

  // Preserve a finished run inside the terminal even after the store trims it.
  useEffect(() => {
    setBlocks((current) => {
      let changed = false
      const next = current.map((block) => {
        if (block.type !== 'run' || !block.runId) return block
        const run = runs[block.runId]
        if (!run?.finished) return block
        if (
          block.snapshot &&
          block.snapshot.status === run.status &&
          block.snapshot.text === run.text &&
          block.snapshot.error === run.error
        ) {
          return block
        }
        changed = true
        return { ...block, snapshot: snapshotRun(run) }
      })
      return changed ? next : current
    })
  }, [runs])

  const nextId = (prefix: string): string => {
    counter.current += 1
    return `${prefix}-${Date.now()}-${counter.current}`
  }

  const appendLines = (lines: TerminalLine[]): void => {
    setBlocks((current) => [...current, { id: nextId('lines'), type: 'lines', lines }])
  }

  const focusInput = (): void => {
    window.setTimeout(() => inputRef.current?.focus(), 20)
  }

  const openConversation = (id: string): void => {
    void loadConversation(id)
    navigate(`/chat/${id}`)
  }

  const openProject = (id: string): void => {
    setPreferredWorkspace(id)
    navigate('/projects')
  }

  const forgetMemory = async (id: string, blockId: string): Promise<void> => {
    try {
      await window.igris.memories.delete(id)
      setBlocks((current) =>
        current.map((block) =>
          block.id === blockId && block.type === 'memory'
            ? { ...block, items: block.items.filter((item) => item.id !== id) }
            : block
        )
      )
      notify('success', 'Memory forgotten')
    } catch (error) {
      notify('error', 'Could not forget memory', errorMessage(error))
    }
  }

  const runLocalCommand = async (command: string): Promise<void> => {
    const name = command.split(/\s+/)[0]
    if (name === '/help') {
      appendLines([
        { text: 'IGRIS terminal commands', tone: 'info' },
        ...TERMINAL_COMMANDS.map((item) => ({
          text: `${item.name.padEnd(12, ' ')} ${item.description}`,
          tone: 'muted' as const
        })),
        { text: 'Anything else is sent to the assistant as natural language.', tone: 'info' }
      ])
      return
    }

    if (name === '/clear') {
      setBlocks([])
      newConversation()
      setRobotError(false)
      appendLines([{ text: 'Terminal cleared. New local context started.', tone: 'success' }])
      focusInput()
      return
    }

    if (name === '/settings') {
      navigate('/settings')
      return
    }

    if (name === '/status') {
      const degraded = health?.checks.some((check) => check.status === 'error')
      appendLines([
        { text: 'SYSTEM STATUS', tone: 'info' },
        {
          text: provider
            ? `provider    ${provider.name} · ${provider.kind} · ${provider.defaultModel || 'no model selected'}`
            : 'provider    none configured',
          tone: providerReady ? 'success' : 'danger'
        },
        {
          text: `core        ${health ? (degraded ? 'degraded' : 'nominal') : 'booting'} · uptime ${health ? uptime(health.uptimeSeconds) : '—'}`,
          tone: degraded ? 'warning' : 'success'
        },
        {
          text: `tools       ${readyTools}/${tools.length} ready · ${grantedPermissions}/8 permissions granted`,
          tone: 'muted'
        },
        {
          text: `projects    ${workspaces.length} approved · ${conversations.length} conversations stored`,
          tone: 'muted'
        },
        {
          text: `database    ${health ? formatBytes(health.databaseBytes) : '—'} · Electron ${system?.electron ?? '—'}`,
          tone: 'muted'
        },
        {
          text: `privacy     DPAPI credentials · local history · cloud models only`,
          tone: 'muted'
        }
      ])
      return
    }

    if (name === '/projects') {
      try {
        const items = await window.igris.projects.list()
        await refreshWorkspaces()
        setBlocks((current) => [
          ...current,
          { id: nextId('projects'), type: 'projects', items }
        ])
      } catch (error) {
        appendLines([{ text: `Could not read projects: ${errorMessage(error)}`, tone: 'danger' }])
      }
      return
    }

    if (name === '/history') {
      try {
        const items = await window.igris.conversations.list()
        await refreshConversations()
        setBlocks((current) => [
          ...current,
          { id: nextId('history'), type: 'history', items }
        ])
      } catch (error) {
        appendLines([{ text: `Could not read history: ${errorMessage(error)}`, tone: 'danger' }])
      }
      return
    }

    if (name === '/memory') {
      try {
        const items = await window.igris.memories.list()
        setBlocks((current) => [...current, { id: nextId('memory'), type: 'memory', items }])
      } catch (error) {
        appendLines([{ text: `Could not read memory: ${errorMessage(error)}`, tone: 'danger' }])
      }
      return
    }

    if (name === '/tools') {
      try {
        const fresh = await window.igris.tools.list()
        await refreshTools()
        setBlocks((current) => [
          ...current,
          {
            id: nextId('tools'),
            type: 'tools',
            groups: capabilitySummary.map((group) => {
              const definition = CAPABILITY_GROUPS.find((item) => item.key === group.key)
              const members = definition ? toolsForCapability(definition, fresh) : []
              return {
                ...group,
                tools: members.length,
                ready: members.filter((tool) => tool.available).length
              }
            }),
            total: fresh.length,
            ready: fresh.filter((tool) => tool.available).length
          }
        ])
      } catch (error) {
        appendLines([{ text: `Could not read tools: ${errorMessage(error)}`, tone: 'danger' }])
      }
      return
    }

    appendLines([
      { text: `Unknown command: ${name}`, tone: 'danger' },
      { text: 'Run /help to list available commands.', tone: 'muted' }
    ])
  }

  const sendNatural = async (raw: string): Promise<void> => {
    if (!provider) {
      appendLines([
        { text: 'No AI provider is connected.', tone: 'danger' },
        { text: 'Open Settings → Providers to add a cloud key, then test the connection.', tone: 'muted' }
      ])
      return
    }
    if (!providerReady) {
      appendLines([
        { text: `${provider.name} has no API key.`, tone: 'danger' },
        { text: 'Open Settings → Providers and save a key before sending requests.', tone: 'muted' }
      ])
      return
    }
    if (!provider.defaultModel) {
      appendLines([
        { text: `${provider.name} has no default model.`, tone: 'warning' },
        { text: 'Open Settings → Providers and select a model before sending requests.', tone: 'muted' }
      ])
      return
    }
    if (activeRuns.length) {
      appendLines([
        { text: 'A response is already running.', tone: 'warning' },
        { text: 'Stop it from the run controls before sending another request.', tone: 'muted' }
      ])
      return
    }
    if (sendingRef.current) return

    const id = nextId('run')
    const at = Date.now()
    sendingRef.current = true
    setSending(true)
    setBlocks((current) => [
      ...current,
      { id, type: 'run', runId: '', userText: raw, at, snapshot: null }
    ])
    pendingBlock.current = { id, text: raw, at }
    try {
      await sendMessage(raw, preferredWorkspaceId)
    } catch (error) {
      pendingBlock.current = null
      setBlocks((current) =>
        current.filter((block) => block.id !== id)
      )
      appendLines([{ text: `Request failed: ${errorMessage(error)}`, tone: 'danger' }])
    } finally {
      sendingRef.current = false
      setSending(false)
      focusInput()
    }
  }

  const submit = async (override?: string): Promise<void> => {
    const raw = (override ?? input).trim()
    if (!raw) return
    setInput('')
    setHistory((current) => [...current, raw].slice(-60))
    setBlocks((current) => [
      ...current,
      { id: nextId('command'), type: 'command', text: raw, at: Date.now(), source: 'user' }
    ])
    if (raw.startsWith('/')) {
      await runLocalCommand(raw)
      focusInput()
      return
    }
    await sendNatural(raw)
  }

  const quickCommand = (command: string): void => {
    if (busy && command !== '/status' && command !== '/help') {
      notify('warning', 'Response in progress', 'Wait for the current response or stop it first.')
      return
    }
    void submit(command)
  }

  const queuedCommand = (location.state as { terminalCommand?: string } | null)?.terminalCommand
  useEffect(() => {
    if (!queuedCommand || handledNavigation.current === location.key) return
    handledNavigation.current = location.key
    navigate('/', { replace: true, state: null })
    void submit(queuedCommand)
    // submit is intentionally excluded: the navigation key guard runs this once per shortcut.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queuedCommand, location.key, navigate])

  const connectionLabel = health
    ? health.checks.some((check) => check.status === 'error')
      ? 'CORE DEGRADED'
      : 'CORE ONLINE'
    : 'CORE BOOTING'
  const selectedWorkspace =
    workspaces.find((item) => item.id === preferredWorkspaceId) ?? null

  const renderRun = (block: Extract<TerminalBlock, { type: 'run' }>) => {
    const run = block.runId ? runs[block.runId] ?? block.snapshot : block.snapshot
    const pending = block.runId
      ? confirmations.filter((item) => item.runId === block.runId)
      : []
    if (!run) {
      return (
        <div className="tw-run is-connecting" key={block.id}>
          <span className="tw-run-author">IGRIS</span>
          <span className="typing-dots">
            <i />
            <i />
            <i />
          </span>
          <span className="tw-run-note">establishing secure link…</span>
        </div>
      )
    }
    return (
      <article className={clsx('tw-run', `is-${run.status}`)} key={block.id}>
        <header className="tw-run-head">
          <span className="tw-run-author">IGRIS</span>
          <span className="tw-run-model">
            {run.providerName || 'provider'} // {run.model || 'model'}
          </span>
          <span className={clsx('tw-run-state', `is-${run.status}`)}>{statusLabel(run)}</span>
          {run.detail ? <span className="tw-run-detail">{run.detail}</span> : null}
        </header>
        {run.tools.length ? (
          <ToolTimeline items={fromToolEvents(run.tools)} compact />
        ) : null}
        {run.text ? <MessageText content={run.text} /> : null}
        {!run.text && !run.error && (!run.finished || run.status === 'starting') ? (
          <div className="tw-run-thinking">
            <span className="typing-dots">
              <i />
              <i />
              <i />
            </span>
            <span>{run.detail ?? 'Working through your request…'}</span>
          </div>
        ) : null}
        {run.error ? <div className="tw-error">{run.error}</div> : null}
        {pending.map((confirmation) => (
          <div className="tw-approval" key={confirmation.id}>
            <div className="tw-approval-head">
              <ShieldAlert size={14} />
              <strong>{confirmation.title}</strong>
              <span>{confirmation.risk} risk</span>
            </div>
            <p>{confirmation.description}</p>
            {confirmation.argumentsPreview ? (
              <pre>{confirmation.argumentsPreview}</pre>
            ) : null}
            <div className="tw-approval-actions">
              <button
                type="button"
                className="tw-btn is-approve"
                onClick={() => void answerConfirmation(confirmation.id, true)}
              >
                Approve once
              </button>
              <button
                type="button"
                className="tw-btn is-deny"
                onClick={() => void answerConfirmation(confirmation.id, false)}
              >
                Deny
              </button>
            </div>
          </div>
        ))}
        <footer className="tw-run-foot">
          <span>
            {new Date(run.startedAt).toLocaleTimeString(undefined, {
              hour: '2-digit',
              minute: '2-digit'
            })}
            {run.finished ? ' · complete' : ' · live'}
          </span>
          <span className="tw-run-foot-actions">
            {!run.finished ? (
              <button
                type="button"
                className="tw-text-btn"
                onClick={() => void cancelRun(run.runId)}
              >
                <Square size={9} /> stop
              </button>
            ) : null}
            {run.conversationId ? (
              <button
                type="button"
                className="tw-text-btn"
                onClick={() => navigate(`/chat/${run.conversationId}`)}
              >
                open thread <ArrowUpRight size={10} />
              </button>
            ) : null}
          </span>
        </footer>
      </article>
    )
  }

  const renderBlock = (block: TerminalBlock) => {
    switch (block.type) {
      case 'command':
        return <TerminalCommand key={block.id} text={block.text} at={block.at} source={block.source} />
      case 'lines':
        return <TerminalLineGroup key={block.id} lines={block.lines} />
      case 'run':
        return renderRun(block)
      case 'history':
        return (
          <div className="tw-panel" key={block.id}>
            <div className="tw-panel-head">
              <History size={13} />
              <span>LOCAL HISTORY · {block.items.length} THREADS</span>
              <button type="button" className="tw-text-btn" onClick={() => navigate('/history')}>
                manage <ArrowUpRight size={10} />
              </button>
            </div>
            {block.items.length ? (
              <div className="tw-list">
                {block.items.slice(0, 10).map((item: ConversationSummary) => (
                  <button
                    key={item.id}
                    type="button"
                    className="tw-list-row"
                    onClick={() => openConversation(item.id)}
                  >
                    <span className="tw-list-main">
                      <strong>{truncate(item.title || 'Untitled thread', 64)}</strong>
                      <small>
                        {item.lastMessage ? truncate(item.lastMessage, 92) : 'No messages yet'}
                      </small>
                    </span>
                    <span className="tw-list-meta">
                      {relativeTime(item.updatedAt)}
                      <small>{item.messageCount} msg</small>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="tw-panel-empty">No conversations stored yet.</p>
            )}
          </div>
        )
      case 'memory':
        return (
          <div className="tw-panel" key={block.id}>
            <div className="tw-panel-head">
              <Brain size={13} />
              <span>LOCAL MEMORY · {block.items.length} ITEMS</span>
            </div>
            {block.items.length ? (
              <div className="tw-list">
                {block.items.map((item: MemoryItem) => (
                  <div key={item.id} className="tw-memory-row">
                    <span className={`tw-memory-kind is-${item.kind}`}>{item.kind}</span>
                    <span className="tw-memory-text">{item.text}</span>
                    <span className="tw-list-meta">{relativeTime(item.updatedAt)}</span>
                    <button
                      type="button"
                      className="tw-text-btn is-danger"
                      onClick={() => void forgetMemory(item.id, block.id)}
                    >
                      forget
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="tw-panel-empty">
                No saved memories. IGRIS can save one when you ask it to remember a preference.
              </p>
            )}
          </div>
        )
      case 'projects':
        return (
          <div className="tw-panel" key={block.id}>
            <div className="tw-panel-head">
              <FolderKanban size={13} />
              <span>APPROVED PROJECTS · {block.items.length}</span>
              <button type="button" className="tw-text-btn" onClick={() => navigate('/projects')}>
                open workspace <ArrowUpRight size={10} />
              </button>
            </div>
            {block.items.length ? (
              <div className="tw-list">
                {block.items.map((item: Workspace) => (
                  <button
                    key={item.id}
                    type="button"
                    className="tw-list-row"
                    onClick={() => openProject(item.id)}
                  >
                    <span className="tw-list-main">
                      <strong>{item.name}</strong>
                      <small>{item.path}</small>
                    </span>
                    <span className="tw-list-meta">
                      {item.kind ?? 'folder'}
                      <small>{item.lastOpenedAt ? relativeTime(item.lastOpenedAt) : 'new'}</small>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="tw-panel-empty">
                No approved folders. Open Projects to approve a workspace root.
              </p>
            )}
          </div>
        )
      case 'tools':
        return (
          <div className="tw-panel" key={block.id}>
            <div className="tw-panel-head">
              <Wrench size={13} />
              <span>
                CAPABILITIES · {block.ready}/{block.total} TOOLS READY
              </span>
              <button type="button" className="tw-text-btn" onClick={() => navigate('/tools')}>
                inspect <ArrowUpRight size={10} />
              </button>
            </div>
            <div className="tw-capability-grid">
              {block.groups.map((group) => (
                <div key={group.key} className="tw-capability">
                  <span className={clsx('tw-capability-dot', group.permissionOn ? 'is-on' : 'is-off')} />
                  <span className="tw-capability-name">{group.label}</span>
                  <span className="tw-capability-meta">
                    {group.tools ? `${group.ready}/${group.tools}` : group.permissionOn ? 'on' : 'off'}
                  </span>
                  <span className="tw-capability-perm">
                    {group.permission === 'none' ? 'no permission' : group.permission}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )
      default:
        return null
    }
  }

  return (
    <div className="page terminal-home home-page">
      <header className="term-head">
        <div className="term-identity">
          <span className="term-identity-mark" aria-hidden>
            <span className="brand-ring" />
            <span className="brand-core" />
          </span>
          <div>
            <div className="term-logo">IGRIS</div>
            <div className="term-sub">
              v{system?.version ?? '1.0.0'} · local ai terminal
            </div>
          </div>
        </div>
        <div className="term-head-meta">
          <span className="term-session">
            SESSION {session} ·{' '}
            {clock.toLocaleDateString(undefined, {
              weekday: 'short',
              month: 'short',
              day: '2-digit'
            })}
          </span>
          <span className={clsx('term-connection', health && 'is-live')}>
            <span className={clsx('status-led', health ? 'is-live' : '')} />
            {connectionLabel}
          </span>
        </div>
      </header>

      <div className="term-layout">
        <div className="term-main">
          <TerminalWindow
            title="igris://home"
            status={
              <span className="tw-bar-provider">
                <span className={clsx('status-led', providerReady ? 'is-live' : 'is-error')} />
                {provider ? `${provider.name} · ${provider.defaultModel || 'model unset'}` : 'no provider'}
              </span>
            }
            actions={
              <button
                type="button"
                className="tw-bar-action"
                onClick={() => navigate('/chat')}
                title="Open the full conversation view"
                aria-label="Open conversation view"
              >
                <ArrowUpRight size={13} />
              </button>
            }
            footer={
              <div className="tw-quickbar">
                <span className="tw-quickbar-label">quick</span>
                {QUICK_COMMANDS.map((command) => (
                  <button
                    key={command}
                    type="button"
                    className="tw-quick"
                    onClick={() => quickCommand(command)}
                  >
                    {command}
                  </button>
                ))}
                <span className="tw-quickbar-hint">
                  or speak naturally · <kbd>/</kbd> for commands
                </span>
              </div>
            }
          >
            <TerminalOutput scrollRef={scrollRef}>
              <div className="tw-welcome">
                <p className="tw-welcome-kicker">
                  // IGRIS CORE · {clock.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                </p>
                <h1>
                  {greeting()}, operator<span className="tw-caret">_</span>
                </h1>
                <p className="tw-welcome-copy">
                  IGRIS is listening. Ask in plain language or run a command. Every tool call is
                  permissioned, audited and paused for approval when the risk requires it.
                </p>
                <div className="tw-welcome-grid">
                  <button type="button" onClick={() => void submit('/status')}>
                    <span>system</span>
                    <strong>{health ? 'nominal' : 'booting'}</strong>
                  </button>
                  <button type="button" onClick={() => void submit('/projects')}>
                    <span>projects</span>
                    <strong>{workspaces.length} approved</strong>
                  </button>
                  <button type="button" onClick={() => void submit('/tools')}>
                    <span>tools</span>
                    <strong>
                      {readyTools}/{tools.length} ready
                    </strong>
                  </button>
                  <button type="button" onClick={() => void submit('/memory')}>
                    <span>memory</span>
                    <strong>local recall</strong>
                  </button>
                </div>
              </div>

              {!provider ? (
                <div className="tw-notice is-warning">
                  <ShieldAlert size={14} />
                  <div>
                    <strong>No AI provider connected.</strong>
                    <p>Add a cloud provider key in Settings before sending natural-language requests.</p>
                  </div>
                  <button type="button" className="tw-btn" onClick={() => navigate('/settings')}>
                    <Settings size={12} /> open settings
                  </button>
                </div>
              ) : !providerReady || !provider.defaultModel ? (
                <div className="tw-notice is-warning">
                  <ShieldAlert size={14} />
                  <div>
                    <strong>{provider.name} needs attention.</strong>
                    <p>
                      {!providerReady
                        ? 'No API key is stored for this provider.'
                        : 'No default model is selected.'}
                    </p>
                  </div>
                  <button type="button" className="tw-btn" onClick={() => navigate('/settings')}>
                    <Settings size={12} /> configure
                  </button>
                </div>
              ) : null}

              {blocks.map(renderBlock)}
              {blocks.length === 0 ? (
                <div className="tw-idle-hint">
                  <CornerDownLeft size={11} />
                  waiting for input
                </div>
              ) : null}
            </TerminalOutput>

            <TerminalInput
              ref={inputRef}
              value={input}
              onChange={setInput}
              onSubmit={(command) => void submit(command)}
              onCancel={() => {
                if (activeRun) void cancelRun(activeRun.runId)
              }}
              busy={busy}
              commands={TERMINAL_COMMANDS as TerminalCommandInfo[]}
              history={history}
              voiceEnabled={Boolean(permissions?.voice && provider?.kind === 'gemini')}
              onVoiceBlocked={() =>
                notify(
                  'warning',
                  'Voice input unavailable',
                  permissions?.voice
                    ? 'Set a Gemini provider as the default to use voice transcription.'
                    : 'Enable microphone access in Settings → Voice.'
                )
              }
              onVoice={(text) => {
                if (text.trim()) void submit(text)
              }}
              onError={(title, message) => notify('error', title, message)}
            />
          </TerminalWindow>

          <TerminalStatus
            items={[
              {
                label: 'tools',
                value: `${readyTools}/${tools.length}`,
                tone: readyTools ? 'live' : 'warn'
              },
              {
                label: 'projects',
                value: String(workspaces.length)
              },
              {
                label: 'permissions',
                value: `${grantedPermissions}/8`,
                tone: grantedPermissions ? 'default' : 'warn'
              },
              {
                label: 'db',
                value: health ? formatBytes(health.databaseBytes) : '—'
              },
              {
                label: 'uptime',
                value: health ? uptime(health.uptimeSeconds) : '—'
              }
            ]}
            hint="cloud models only · local-first storage · approvals enforced"
          />
        </div>

        <aside className="term-aside">
          <div className="term-robot-panel">
            <div className="term-robot-head">
              <span>UNIT // 01</span>
              <span className={clsx('term-robot-state', `is-${robotState}`)}>
                <i className={clsx('status-led', robotState === 'error' ? 'is-error' : 'is-live')} />
                {robotMeta.label}
              </span>
            </div>
            <RobotCompanion
              state={robotState}
              quality={settings?.appearance.quality}
              reducedMotion={settings?.appearance.reducedMotion}
              enabled={settings?.appearance.show3d ?? true}
            />
            <p className="term-robot-caption">{robotMeta.caption}</p>
          </div>

          <div className="term-aside-block">
            <span className="term-aside-label">ACTIVE CONTEXT</span>
            <div className="term-aside-row">
              <span>provider</span>
              <strong>{provider ? provider.name : 'none'}</strong>
            </div>
            <div className="term-aside-row">
              <span>model</span>
              <strong>{provider?.defaultModel || 'unset'}</strong>
            </div>
            <label className="term-aside-row is-control">
              <span>workspace</span>
              <select
                value={preferredWorkspaceId ?? ''}
                onChange={(event) => setPreferredWorkspace(event.target.value || null)}
                aria-label="Active project workspace"
              >
                <option value="">No project</option>
                {workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="term-aside-row">
              <span>context</span>
              <strong className="is-mono">
                {selectedWorkspace ? selectedWorkspace.kind ?? 'folder' : 'global'}
              </strong>
            </div>
          </div>

          <div className="term-aside-block">
            <span className="term-aside-label">SECURITY POSTURE</span>
            <div className="term-aside-row">
              <span>approvals</span>
              <strong>{confirmations.length ? `${confirmations.length} pending` : 'clear'}</strong>
            </div>
            <div className="term-aside-row">
              <span>credentials</span>
              <strong>
                <ShieldCheck size={11} /> DPAPI
              </strong>
            </div>
            <div className="term-aside-row">
              <span>models</span>
              <strong>cloud only</strong>
            </div>
            <button
              type="button"
              className="term-aside-link"
              onClick={() => navigate('/settings')}
            >
              manage permissions <ArrowUpRight size={11} />
            </button>
          </div>
        </aside>
      </div>
    </div>
  )
}
