import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent
} from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowDown,
  Check,
  Copy,
  Edit3,
  Pencil,
  RotateCcw,
  SendHorizontal,
  Sparkles,
  Square
} from 'lucide-react'
import { useAppStore, selectLatestActiveRun, type ActiveRun } from '../lib/store'
import { MessageText } from '../components/Markdown'
import {
  ToolTimeline,
  fromToolEvents,
  fromToolRecords,
  type TimelineItem
} from '../components/ToolTimeline'
import { Badge, Button, IconButton, Input, Modal, Spinner, Textarea } from '../components/ui'
import { clockTime, fullTime } from '../lib/format'
import type { ChatMessage } from '@shared/types'

const SUGGESTIONS = [
  'What can you do with the permissions I have enabled?',
  'Summarize the project I have open and find its biggest risks.',
  'Open the browser and research something for me.',
  'Help me plan the next hour with realistic priorities.'
]

function copyText(text: string): void {
  if (!text) return
  if (window.igris) void window.igris.system.copyText(text)
  else void navigator.clipboard.writeText(text)
}

function UserMessage({
  message,
  editing,
  editValue,
  onEdit,
  onEditChange,
  onCancelEdit,
  onSaveEdit
}: {
  message: ChatMessage
  editing: boolean
  editValue: string
  onEdit: () => void
  onEditChange: (value: string) => void
  onCancelEdit: () => void
  onSaveEdit: () => void
}) {
  const [copied, setCopied] = useState(false)
  return (
    <article className="message message-user">
      <div className="message-user-card">
        {editing ? (
          <div className="edit-message">
            <Textarea
              value={editValue}
              onChange={(event) => onEditChange(event.target.value)}
              rows={4}
              autoFocus
            />
            <div className="edit-message-actions">
              <Button variant="ghost" size="sm" onClick={onCancelEdit}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={onSaveEdit} disabled={!editValue.trim()}>
                Save & resend
              </Button>
            </div>
          </div>
        ) : (
          <p className="user-text">{message.content}</p>
        )}
        <div className="message-user-meta">
          <span>{clockTime(message.createdAt)}</span>
          <div className="message-actions">
            <IconButton
              label={copied ? 'Copied' : 'Copy message'}
              size="sm"
              onClick={() => {
                copyText(message.content)
                setCopied(true)
                window.setTimeout(() => setCopied(false), 1400)
              }}
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
            </IconButton>
            <IconButton label="Edit and resend" size="sm" onClick={onEdit}>
              <Edit3 size={12} />
            </IconButton>
          </div>
        </div>
      </div>
    </article>
  )
}

function AssistantMessage({
  message,
  onRegenerate,
  canRegenerate
}: {
  message: ChatMessage
  onRegenerate: () => void
  canRegenerate: boolean
}) {
  const [copied, setCopied] = useState(false)
  const [showMeta, setShowMeta] = useState(false)
  const meta = message.meta
  const toolItems: TimelineItem[] = meta?.toolExecutions?.length
    ? fromToolRecords(meta.toolExecutions)
    : []
  const provider = meta?.providerName ?? 'IGRIS'
  const model = meta?.model ?? ''

  return (
    <article className="message message-assistant">
      <div className="message-avatar" aria-hidden>
        <span className="brand-ring" />
        <span className="brand-core" />
      </div>
      <div className="message-assistant-body">
        <header className="message-head">
          <span className="message-author">{provider}</span>
          {model ? <span className="message-model">{model}</span> : null}
          {meta?.cancelled ? <Badge tone="neutral">Stopped</Badge> : null}
          {meta?.error ? <Badge tone="danger">Error</Badge> : null}
        </header>
        {toolItems.length ? <ToolTimeline items={toolItems} compact /> : null}
        {message.content ? <MessageText content={message.content} /> : null}
        {meta?.error ? <div className="message-error">{meta.error}</div> : null}
        {!message.content && !meta?.error ? (
          <p className="message-empty">No text was returned.</p>
        ) : null}
        <footer className="message-footer">
          <span>{fullTime(message.createdAt)}</span>
          {meta?.durationMs ? <span>{Math.round(meta.durationMs / 100) / 10}s</span> : null}
          {meta?.usage?.totalTokens ? (
            <button
              type="button"
              className="meta-toggle"
              onClick={() => setShowMeta((value) => !value)}
            >
              {meta.usage.totalTokens.toLocaleString()} tokens
            </button>
          ) : null}
          <div className="message-actions">
            <IconButton
              label={copied ? 'Copied' : 'Copy response'}
              size="sm"
              onClick={() => {
                copyText(message.content)
                setCopied(true)
                window.setTimeout(() => setCopied(false), 1400)
              }}
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
            </IconButton>
            <IconButton
              label="Regenerate response"
              size="sm"
              onClick={onRegenerate}
              disabled={!canRegenerate}
            >
              <RotateCcw size={12} />
            </IconButton>
          </div>
        </footer>
        {showMeta && meta?.usage ? (
          <div className="message-meta-detail">
            <span>Input {meta.usage.inputTokens?.toLocaleString() ?? '—'}</span>
            <span>Output {meta.usage.outputTokens?.toLocaleString() ?? '—'}</span>
            <span>Total {meta.usage.totalTokens?.toLocaleString() ?? '—'}</span>
          </div>
        ) : null}
      </div>
    </article>
  )
}

function LiveRun({ run }: { run: ActiveRun }) {
  const toolItems = fromToolEvents(run.tools)
  const statusLabel =
    run.status === 'starting'
      ? 'Connecting'
      : run.status === 'thinking'
        ? 'Thinking'
        : run.status === 'working'
          ? 'Working'
          : run.status === 'streaming'
            ? 'Writing'
            : run.status === 'failed'
              ? 'Failed'
              : run.status === 'cancelled'
                ? 'Stopped'
                : 'Complete'

  return (
    <article className="message message-assistant is-live">
      <div className="message-avatar" aria-hidden>
        <span className="brand-ring" />
        <span className="brand-core" />
      </div>
      <div className="message-assistant-body">
        <header className="message-head">
          <span className="message-author">{run.providerName || 'IGRIS'}</span>
          {run.model ? <span className="message-model">{run.model}</span> : null}
          <Badge
            tone={
              run.status === 'failed'
                ? 'danger'
                : run.status === 'cancelled'
                  ? 'neutral'
                  : 'accent'
            }
            dot
          >
            {statusLabel}
          </Badge>
          {run.detail ? <span className="run-detail">{run.detail}</span> : null}
        </header>
        {toolItems.length ? <ToolTimeline items={toolItems} /> : null}
        {run.text ? <MessageText content={run.text} /> : null}
        {!run.text && !run.error ? (
          <div className="typing-block">
            <span className="typing-dots">
              <i />
              <i />
              <i />
            </span>
            <span>{run.detail ?? (run.status === 'thinking' ? 'Reasoning…' : 'Working…')}</span>
          </div>
        ) : null}
        {run.error ? <div className="message-error">{run.error}</div> : null}
        {run.status === 'streaming' && run.text ? <span className="stream-caret" aria-hidden /> : null}
      </div>
    </article>
  )
}

export function ChatPage() {
  const { conversationId } = useParams()
  const navigate = useNavigate()
  const settings = useAppStore((state) => state.settings)
  const providers = useAppStore((state) => state.providers)
  const workspaces = useAppStore((state) => state.workspaces)
  const activeConversation = useAppStore((state) => state.activeConversation)
  const messages = useAppStore((state) => state.messages)
  const loadingConversation = useAppStore((state) => state.loadingConversation)
  const runs = useAppStore((state) => state.runs)
  const composerDraft = useAppStore((state) => state.composerDraft)
  const preferredProviderId = useAppStore((state) => state.preferredProviderId)
  const preferredWorkspaceId = useAppStore((state) => state.preferredWorkspaceId)
  const loadConversation = useAppStore((state) => state.loadConversation)
  const newConversation = useAppStore((state) => state.newConversation)
  const sendMessage = useAppStore((state) => state.sendMessage)
  const cancelRun = useAppStore((state) => state.cancelRun)
  const regenerate = useAppStore((state) => state.regenerate)
  const editAndResend = useAppStore((state) => state.editAndResend)
  const renameConversation = useAppStore((state) => state.renameConversation)
  const setComposerDraft = useAppStore((state) => state.setComposerDraft)
  const setPreferredProvider = useAppStore((state) => state.setPreferredProvider)
  const setPreferredWorkspace = useAppStore((state) => state.setPreferredWorkspace)
  const notify = useAppStore((state) => state.notify)

  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [renameTarget, setRenameTarget] = useState<{ id: string; title: string } | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [busyDialog, setBusyDialog] = useState(false)
  const [showJump, setShowJump] = useState(false)
  const threadRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (conversationId) void loadConversation(conversationId)
    else newConversation()
  }, [conversationId, loadConversation, newConversation])

  useEffect(() => {
    if (!composerDraft) return
    setDraft(composerDraft)
    setComposerDraft('')
    window.setTimeout(() => composerRef.current?.focus(), 60)
  }, [composerDraft, setComposerDraft])

  useEffect(() => {
    const element = composerRef.current
    if (!element) return
    element.style.height = '0px'
    element.style.height = `${Math.min(190, Math.max(48, element.scrollHeight))}px`
  }, [draft])

  const conversationRuns = useMemo(() => {
    if (!conversationId) return []
    return Object.values(runs)
      .filter((run) => run.conversationId === conversationId)
      .sort((a, b) => a.startedAt - b.startedAt)
      .filter(
        (run) =>
          !run.finished || !messages.some((message) => message.id === run.assistantMessageId)
      )
  }, [runs, conversationId, messages])

  const latestActiveRun = useMemo(
    () => (conversationId ? selectLatestActiveRun(runs, conversationId) : null),
    [runs, conversationId]
  )

  const provider =
    providers.find((item) => item.id === preferredProviderId) ??
    providers.find((item) => item.isDefault) ??
    providers[0] ??
    null
  const configured = providers.length > 0
  const modelMissing = Boolean(provider && !provider.defaultModel)
  const streamSignal = conversationRuns
    .map((run) => `${run.status}:${run.text.length}:${run.tools.length}`)
    .join('|')
  const lastAssistant = [...messages].reverse().find((message) => message.role === 'assistant')

  useEffect(() => {
    const element = threadRef.current
    if (!element) return
    element.scrollTop = element.scrollHeight
  }, [messages, loadingConversation, streamSignal])

  useEffect(() => {
    const element = threadRef.current
    if (!element) return
    const onScroll = (): void => {
      const distance = element.scrollHeight - element.scrollTop - element.clientHeight
      setShowJump(distance > 260)
    }
    element.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => element.removeEventListener('scroll', onScroll)
  }, [])

  const scrollToBottom = (): void => {
    const element = threadRef.current
    if (element) element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' })
  }

  const submit = async (): Promise<void> => {
    const content = draft.trim()
    if (!content || latestActiveRun) return
    if (!configured) {
      notify('warning', 'Add an AI provider first', 'Open AI models to connect a cloud provider.')
      return
    }
    setDraft('')
    try {
      await sendMessage(content, preferredWorkspaceId)
    } catch {
      setDraft(content)
    }
  }

  const handleComposerKey = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void submit()
    }
  }

  const openRename = (id: string, title: string): void => {
    setRenameTarget({ id, title })
    setRenameValue(title)
  }

  const confirmRename = async (): Promise<void> => {
    if (!renameTarget || !renameValue.trim()) return
    setBusyDialog(true)
    await renameConversation(renameTarget.id, renameValue.trim())
    setBusyDialog(false)
    setRenameTarget(null)
  }

  const beginEdit = (message: ChatMessage): void => {
    setEditingId(message.id)
    setEditValue(message.content)
  }

  const saveEdit = async (): Promise<void> => {
    if (!editingId || !editValue.trim()) return
    const content = editValue.trim()
    setEditingId(null)
    setEditValue('')
    await editAndResend(editingId, content)
  }

  const empty = !messages.length && !conversationRuns.length
  const title = activeConversation?.title ?? 'New conversation'

  return (
    <div className="chat-page">

      <section className="chat-main">
        <header className="chat-header">
          <div className="chat-header-copy">
            <div className="eyebrow">Conversation</div>
            <div className="chat-title-row">
              <h1>{title}</h1>
              {activeConversation ? (
                <IconButton
                  label="Rename conversation"
                  size="sm"
                  onClick={() => openRename(activeConversation.id, activeConversation.title)}
                >
                  <Pencil size={12} />
                </IconButton>
              ) : null}
            </div>
          </div>
          <div className="chat-header-meta">
            {provider ? (
              <>
                <span className="chat-provider-dot" />
                <span>{provider.name}</span>
                <span className="chat-header-divider" />
                <span className="mono">{provider.defaultModel || 'No model'}</span>
              </>
            ) : (
              <Badge tone="warning">No provider</Badge>
            )}
            {latestActiveRun ? (
              <Badge tone="accent" dot>
                Live
              </Badge>
            ) : null}
          </div>
        </header>

        <div className="chat-thread" ref={threadRef}>
          <div className="chat-thread-inner">
            {!configured ? (
              <div className="chat-banner">
                <div>
                  <strong>IGRIS needs a mind.</strong>
                  <p>Connect a cloud provider to begin. Nothing is simulated.</p>
                </div>
                <Button variant="primary" size="sm" onClick={() => navigate('/models')}>
                  Configure AI models
                </Button>
              </div>
            ) : null}

            {modelMissing ? (
              <div className="chat-banner is-warn">
                <div>
                  <strong>No model selected for {provider?.name}.</strong>
                  <p>Choose a model so requests can be routed.</p>
                </div>
                <Button variant="default" size="sm" onClick={() => navigate('/models')}>
                  Choose model
                </Button>
              </div>
            ) : null}

            {loadingConversation && !messages.length ? (
              <div className="chat-loading">
                <Spinner size={20} />
                <span>Loading conversation…</span>
              </div>
            ) : null}

            {empty && !loadingConversation ? (
              <div className="chat-empty">
                <div className="chat-empty-mark" aria-hidden>
                  <span className="brand-ring" />
                  <span className="brand-core" />
                </div>
                <div className="eyebrow">Open channel</div>
                <h2>What should we make of today?</h2>
                <p>
                  Ask a question, hand over a task, or point IGRIS at a project. Responses stream
                  from your selected model with real tools behind them.
                </p>
                <div className="suggestion-grid">
                  {SUGGESTIONS.map((suggestion, index) => (
                    <button
                      key={suggestion}
                      type="button"
                      className="suggestion"
                      onClick={() => {
                        setDraft(suggestion)
                        window.setTimeout(() => composerRef.current?.focus(), 20)
                      }}
                    >
                      <span className="suggestion-index">0{index + 1}</span>
                      <span>{suggestion}</span>
                      <Sparkles size={13} />
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="message-list">
              {messages.map((message) =>
                message.role === 'user' ? (
                  <UserMessage
                    key={message.id}
                    message={message}
                    editing={editingId === message.id}
                    editValue={editValue}
                    onEdit={() => beginEdit(message)}
                    onEditChange={setEditValue}
                    onCancelEdit={() => {
                      setEditingId(null)
                      setEditValue('')
                    }}
                    onSaveEdit={() => void saveEdit()}
                  />
                ) : (
                  <AssistantMessage
                    key={message.id}
                    message={message}
                    onRegenerate={() => void regenerate(message.id)}
                    canRegenerate={!latestActiveRun && message.id === lastAssistant?.id}
                  />
                )
              )}
              {conversationRuns.map((run) => (
                <LiveRun key={run.runId} run={run} />
              ))}
            </div>
          </div>
        </div>

        {showJump ? (
          <button type="button" className="jump-latest" onClick={scrollToBottom}>
            <ArrowDown size={14} />
            Latest
          </button>
        ) : null}

        <footer className="composer-shell">
          <div className="composer">
            <Textarea
              ref={composerRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleComposerKey}
              placeholder={
                configured
                  ? 'Message IGRIS…  Enter to send, Shift+Enter for a new line'
                  : 'Connect a provider to start…'
              }
              rows={1}
              disabled={!configured}
              className="composer-input"
            />
            <div className="composer-bar">
              <div className="composer-context">
                <label className="composer-select">
                  <span>Model</span>
                  <select
                    value={provider?.id ?? ''}
                    onChange={(event) => setPreferredProvider(event.target.value || null)}
                    disabled={!providers.length}
                  >
                    {providers.length ? (
                      providers.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} · {item.defaultModel || 'no model'}
                        </option>
                      ))
                    ) : (
                      <option value="">No providers</option>
                    )}
                  </select>
                </label>
                <label className="composer-select">
                  <span>Project</span>
                  <select
                    value={preferredWorkspaceId ?? ''}
                    onChange={(event) => setPreferredWorkspace(event.target.value || null)}
                    disabled={!workspaces.length}
                  >
                    <option value="">No project</option>
                    {workspaces.map((workspace) => (
                      <option key={workspace.id} value={workspace.id}>
                        {workspace.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="composer-actions">
                {latestActiveRun ? (
                  <Button
                    variant="danger"
                    size="sm"
                    icon={<Square size={12} />}
                    onClick={() => void cancelRun(latestActiveRun.runId)}
                  >
                    Stop
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => void submit()}
                    disabled={!draft.trim() || !configured}
                    icon={<SendHorizontal size={14} />}
                  >
                    Send
                  </Button>
                )}
              </div>
            </div>
          </div>
          <div className="composer-footnote">
            <span>
              <Check size={11} /> Cloud responses may be inaccurate. Verify consequential actions.
            </span>
            <span className="mono">{settings?.ai.streaming ? 'STREAM ON' : 'STREAM OFF'}</span>
          </div>
        </footer>
      </section>

      <Modal
        open={Boolean(renameTarget)}
        onClose={() => setRenameTarget(null)}
        title="Rename conversation"
        width={460}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenameTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => void confirmRename()}
              loading={busyDialog}
              disabled={!renameValue.trim()}
            >
              Save title
            </Button>
          </>
        }
      >
        <Input
          value={renameValue}
          onChange={(event) => setRenameValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void confirmRename()
          }}
          placeholder="Conversation title"
          maxLength={120}
        />
      </Modal>
    </div>
  )
}
