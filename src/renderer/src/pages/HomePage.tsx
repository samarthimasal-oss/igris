import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Bot,
  Cpu,
  FolderKanban,
  Globe2,
  MessageSquare,
  Plus,
  ShieldCheck,
  Sparkles,
  Terminal,
  Wrench,
  Zap
} from 'lucide-react'
import { useAppStore } from '../lib/store'
import { IgrisCore } from '../components/IgrisCore'
import { Badge, Button, Card } from '../components/ui'
import { formatBytes, greeting, plural, relativeTime, truncate, uptime } from '../lib/format'
import clsx from 'clsx'

const QUICK_PROMPTS = [
  { icon: Sparkles, label: 'Plan my day', prompt: 'Help me plan my day. Ask me what is on my plate, then propose a realistic sequence.' },
  { icon: FolderKanban, label: 'Review a project', prompt: 'Review the project I have open. Read its structure, identify risks, and propose the first three improvements.' },
  { icon: Globe2, label: 'Search the web', prompt: 'Open a DuckDuckGo search in my default browser for the topic I give you.' },
  { icon: Terminal, label: 'Run a command', prompt: 'Run the test suite for my current project and explain any failures.' }
]

const CAPABILITIES = [
  {
    icon: MessageSquare,
    title: 'Think in conversation',
    description: 'Streaming cloud models with memory, tool use, and a complete local history.',
    to: '/chat',
    action: 'Open conversation'
  },
  {
    icon: FolderKanban,
    title: 'Build with context',
    description: 'Approved project folders, file search, a live editor, and guarded writes.',
    to: '/projects',
    action: 'Open projects'
  },
  {
    icon: Wrench,
    title: 'Act on the machine',
    description: 'Terminal, applications, screen capture, browser, and native input — permissioned.',
    to: '/tools',
    action: 'Inspect toolkit'
  }
]

const ACTIVE_STATUSES = new Set(['queued', 'planning', 'awaiting_confirmation', 'running'])

export function HomePage() {
  const navigate = useNavigate()
  const settings = useAppStore((state) => state.settings)
  const providers = useAppStore((state) => state.providers)
  const tools = useAppStore((state) => state.tools)
  const workspaces = useAppStore((state) => state.workspaces)
  const tasks = useAppStore((state) => state.tasks)
  const conversations = useAppStore((state) => state.conversations)
  const health = useAppStore((state) => state.health)
  const system = useAppStore((state) => state.system)
  const companion = useAppStore((state) => state.companion)
  const setComposerDraft = useAppStore((state) => state.setComposerDraft)
  const refreshCompanion = useAppStore((state) => state.refreshCompanion)
  const notify = useAppStore((state) => state.notify)
  const [prompt, setPrompt] = useState('')

  const appearance = settings?.appearance
  const configuredProviders = providers.filter(
    (provider) => provider.hasKey || provider.kind === 'openai-compatible'
  )
  const activeProvider = providers.find((provider) => provider.isDefault) ?? providers[0] ?? null
  const activeTasks = tasks.filter((task) => ACTIVE_STATUSES.has(task.status)).length
  const availableTools = tools.filter((tool) => tool.available).length
  const recent = conversations.slice(0, 4)
  const checks = health?.checks.slice(0, 4) ?? []
  const date = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric'
  })

  const startPrompt = (text: string): void => {
    const clean = text.trim()
    if (!clean) {
      navigate('/chat')
      return
    }
    setComposerDraft(clean)
    navigate('/chat')
  }

  const toggleCompanion = async (): Promise<void> => {
    if (!window.igris) return
    try {
      if (companion?.enabled) await window.igris.companion.hide()
      else await window.igris.companion.show()
      await refreshCompanion()
    } catch (error) {
      notify('error', 'Companion unavailable', error instanceof Error ? error.message : undefined)
    }
  }

  return (
    <div className="page home-page">
      <header className="home-topline">
        <div>
          <div className="eyebrow">Command deck</div>
          <h1 className="home-greeting">
            {greeting()}.
            <span> IGRIS is standing by.</span>
          </h1>
        </div>
        <div className="home-dateline">
          <span>{date}</span>
          <span className="statusbar-divider" />
          <span className={clsx('status-led', health ? 'is-live' : '')} />
          <span>{health ? 'Core nominal' : 'Assembling'}</span>
        </div>
      </header>

      <section className="hero-grid">
        <Card className="hero-panel">
          <div className="hero-copy">
            <Badge tone="accent" dot>
              {activeProvider ? `${activeProvider.name} · ${activeProvider.defaultModel || 'model pending'}` : 'No provider connected'}
            </Badge>
            <h2>
              Your desktop,
              <br />
              <span className="gradient-text">composed.</span>
            </h2>
            <p>
              One calm surface for asking, drafting, researching, and directing your entire
              Windows machine. Every consequential action stays behind your approval.
            </p>
            <form
              className="hero-prompt"
              onSubmit={(event) => {
                event.preventDefault()
                startPrompt(prompt)
              }}
            >
              <Sparkles size={16} className="hero-prompt-icon" />
              <input
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Ask anything, or describe a task…"
                aria-label="Start a conversation"
              />
              <Button variant="primary" size="sm" type="submit" aria-label="Open in conversation">
                <ArrowRight size={15} />
              </Button>
            </form>
            <div className="hero-actions">
              <Button variant="default" onClick={() => navigate('/chat')} icon={<MessageSquare size={15} />}>
                Start a conversation
              </Button>
              <Button variant="ghost" onClick={() => navigate('/tools')} trailingIcon={<ArrowRight size={14} />}>
                Explore capabilities
              </Button>
            </div>
            <div className="hero-meta">
              <span>
                <ShieldCheck size={12} /> Permissioned tools
              </span>
              <span>
                <Zap size={12} /> Streaming responses
              </span>
              <span>
                <Cpu size={12} /> Cloud models only
              </span>
            </div>
          </div>

          <div className="hero-core">
            <div className="hero-core-grid" aria-hidden />
            <div className="core-readout core-readout-tl">
              <span>CORE</span>
              <strong>IGRIS / 01</strong>
            </div>
            <div className="core-readout core-readout-tr">
              <span className={clsx('status-led', health?.checks.some((check) => check.status === 'error') ? 'is-error' : 'is-live')} />
              {activeProvider ? 'LINK READY' : 'STANDBY'}
            </div>
            <IgrisCore
              accent={appearance?.accent}
              quality={appearance?.quality}
              intensity={appearance?.animationIntensity}
              reducedMotion={appearance?.reducedMotion}
              enabled={appearance?.show3d}
            />
            <div className="core-readout core-readout-bl">
              <span>MODE</span>
              <strong>Cloud intelligence</strong>
            </div>
            <div className="core-readout core-readout-br">
              <span>COMPANION</span>
              <button type="button" className="core-link" onClick={() => void toggleCompanion()}>
                <Bot size={12} />
                {companion?.enabled ? 'On desktop' : 'Summon'}
              </button>
            </div>
          </div>
        </Card>
      </section>

      <section className="home-stats" aria-label="System summary">
        <div className="home-stat">
          <span className="home-stat-icon"><Cpu size={15} /></span>
          <div>
            <strong>{configuredProviders.length || '—'}</strong>
            <span>connected provider{configuredProviders.length === 1 ? '' : 's'}</span>
          </div>
        </div>
        <div className="home-stat">
          <span className="home-stat-icon"><Wrench size={15} /></span>
          <div>
            <strong>{availableTools}</strong>
            <span>tools ready</span>
          </div>
        </div>
        <div className="home-stat">
          <span className="home-stat-icon"><FolderKanban size={15} /></span>
          <div>
            <strong>{workspaces.length}</strong>
            <span>approved project{workspaces.length === 1 ? '' : 's'}</span>
          </div>
        </div>
        <div className="home-stat">
          <span className="home-stat-icon"><Activity size={15} /></span>
          <div>
            <strong>{activeTasks}</strong>
            <span>active task{activeTasks === 1 ? '' : 's'}</span>
          </div>
        </div>
      </section>

      {!activeProvider ? (
        <Card className="home-setup">
          <div className="home-setup-icon"><Cpu size={20} /></div>
          <div>
            <strong>Connect an AI provider to bring IGRIS to life.</strong>
            <p>No simulated responses. Add a cloud key and test the connection in AI Models.</p>
          </div>
          <Button variant="primary" onClick={() => navigate('/models')} trailingIcon={<ArrowRight size={14} />}>
            Configure models
          </Button>
        </Card>
      ) : null}

      <section className="home-columns">
        <Card className="home-recent">
          <div className="section-heading compact">
            <div>
              <h2>Recent threads</h2>
              <p>Your local history, ready to resume.</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => navigate('/chat')} trailingIcon={<ArrowUpRight size={13} />}>
              All
            </Button>
          </div>
          {recent.length ? (
            <div className="recent-list">
              {recent.map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  className="recent-row"
                  onClick={() => navigate(`/chat/${conversation.id}`)}
                >
                  <span className="recent-icon"><MessageSquare size={14} /></span>
                  <span className="recent-copy">
                    <strong>{conversation.title}</strong>
                    <small>
                      {conversation.lastMessage
                        ? truncate(conversation.lastMessage, 74)
                        : 'Empty conversation'}
                    </small>
                  </span>
                  <span className="recent-meta">
                    <span>{relativeTime(conversation.updatedAt)}</span>
                    <small>{plural(conversation.messageCount, 'message')}</small>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="home-mini-empty">
              <MessageSquare size={18} />
              <p>No conversations yet. Your first thread starts here.</p>
              <Button variant="default" size="sm" onClick={() => startPrompt('')} icon={<Plus size={14} />}>
                New conversation
              </Button>
            </div>
          )}
        </Card>

        <Card className="home-pulse">
          <div className="section-heading compact">
            <div>
              <h2>System pulse</h2>
              <p>Live checks from the local core.</p>
            </div>
            <Badge tone={health?.checks.some((check) => check.status === 'error') ? 'warning' : 'success'} dot>
              {health ? 'Nominal' : 'Booting'}
            </Badge>
          </div>
          <div className="pulse-checks">
            {checks.length ? (
              checks.map((check) => (
                <div key={check.id} className="pulse-row">
                  <span className={clsx('pulse-dot', `is-${check.status}`)} />
                  <span className="pulse-label">{check.label}</span>
                  <span className="pulse-detail">{check.detail}</span>
                </div>
              ))
            ) : (
              <div className="home-mini-empty pulse-loading">
                <Activity size={18} />
                <p>Collecting local telemetry…</p>
              </div>
            )}
          </div>
          <div className="pulse-footer">
            <div>
              <span>Database</span>
              <strong>{health ? formatBytes(health.databaseBytes) : '—'}</strong>
            </div>
            <div>
              <span>Uptime</span>
              <strong>{health ? uptime(health.uptimeSeconds) : '—'}</strong>
            </div>
            <div>
              <span>Runtime</span>
              <strong>Electron {system?.electron ?? '—'}</strong>
            </div>
          </div>
        </Card>
      </section>

      <section className="capability-grid">
        {CAPABILITIES.map((capability) => {
          const Icon = capability.icon
          return (
            <Card key={capability.title} className="capability-card">
              <div className="capability-icon"><Icon size={18} /></div>
              <h3>{capability.title}</h3>
              <p>{capability.description}</p>
              <button type="button" className="link-button" onClick={() => navigate(capability.to)}>
                {capability.action}
                <ArrowRight size={13} />
              </button>
            </Card>
          )
        })}
      </section>

      <section className="home-quick">
        <div className="section-heading">
          <div>
            <h2>Open with an intention</h2>
            <p>Prompts that use the real capabilities you have enabled.</p>
          </div>
        </div>
        <div className="quick-grid">
          {QUICK_PROMPTS.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.label}
                type="button"
                className="quick-card"
                onClick={() => startPrompt(item.prompt)}
              >
                <Icon size={16} />
                <span>{item.label}</span>
                <ArrowUpRight size={14} className="quick-arrow" />
              </button>
            )
          })}
        </div>
      </section>
    </div>
  )
}
