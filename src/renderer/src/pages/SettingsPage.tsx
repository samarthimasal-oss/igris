import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Activity,
  Check,
  Cpu,
  Database,
  Download,
  FolderOpen,
  Info,
  KeyRound,
  Lock,
  Mic,
  Monitor,
  Palette,
  RefreshCw,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
  Trash2,
  Wand2,
  Wifi
} from 'lucide-react'
import { PERMISSION_META, PROVIDER_CATALOG } from '@shared/defaults'
import type {
  DeepPartial,
  LogEntry,
  ModelListResult,
  PermissionKey,
  ProviderTestResult,
  Settings
} from '@shared/types'
import { useAppStore } from '../lib/store'
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Field,
  Input,
  KeyValue,
  PageHeader,
  SegmentedControl,
  Select,
  Slider,
  Textarea,
  Toggle
} from '../components/ui'
import { errorMessage } from '../lib/errors'
import { formatBytes, fullTime, plural, relativeTime } from '../lib/format'
import clsx from 'clsx'

const PERMISSION_ORDER: PermissionKey[] = [
  'filesystem',
  'fileWrite',
  'projectWrite',
  'terminal',
  'appLaunch',
  'browser',
  'browserControl',
  'desktopControl',
  'screen',
  'voice'
]

const SECTION_LINKS = [
  { id: 'settings-providers', label: 'Providers', icon: Server },
  { id: 'settings-intelligence', label: 'Intelligence', icon: SlidersHorizontal },
  { id: 'settings-permissions', label: 'Permissions', icon: ShieldCheck },
  { id: 'settings-voice', label: 'Voice', icon: Mic },
  { id: 'settings-companion', label: 'Companion', icon: Monitor },
  { id: 'settings-appearance', label: 'Appearance', icon: Palette },
  { id: 'settings-privacy', label: 'Privacy & data', icon: Lock },
  { id: 'settings-diagnostics', label: 'Diagnostics', icon: Activity },
  { id: 'settings-about', label: 'About', icon: Info }
]

type SaveState = 'idle' | 'saving' | 'saved'

export function SettingsPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const settings = useAppStore((state) => state.settings)
  const system = useAppStore((state) => state.system)
  const health = useAppStore((state) => state.health)
  const providers = useAppStore((state) => state.providers)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const refreshProviders = useAppStore((state) => state.refreshProviders)
  const refreshConversations = useAppStore((state) => state.refreshConversations)
  const newConversation = useAppStore((state) => state.newConversation)
  const setPreferredProvider = useAppStore((state) => state.setPreferredProvider)
  const openOnboarding = useAppStore((state) => state.openOnboarding)
  const notify = useAppStore((state) => state.notify)

  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [instructions, setInstructions] = useState(settings?.ai.systemInstructions ?? '')
  const [instructionsDirty, setInstructionsDirty] = useState(false)
  const [clearOpen, setClearOpen] = useState(false)
  const [clearConversations, setClearConversations] = useState(true)
  const [clearMemories, setClearMemories] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [resetting, setResetting] = useState(false)

  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [providerSaving, setProviderSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [discovering, setDiscovering] = useState(false)
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null)
  const [modelResult, setModelResult] = useState<ModelListResult | null>(null)

  const [logs, setLogs] = useState<LogEntry[]>([])
  const [logsBusy, setLogsBusy] = useState(false)
  const [clearLogsOpen, setClearLogsOpen] = useState(false)
  const [clearingLogs, setClearingLogs] = useState(false)
  const [exportingDiagnostics, setExportingDiagnostics] = useState(false)

  const saveTimer = useRef<number | null>(null)

  const selectedProvider =
    providers.find((provider) => provider.id === selectedProviderId) ??
    providers.find((provider) => provider.isDefault) ??
    providers[0] ??
    null
  const defaultProvider = providers.find((provider) => provider.isDefault) ?? providers[0] ?? null
  const geminiProvider = providers.find((provider) => provider.kind === 'gemini') ?? null
  const voiceReady = Boolean(settings?.permissions.voice && defaultProvider?.kind === 'gemini')

  useEffect(() => {
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
    }
  }, [])

  useEffect(() => {
    if (providers.length && !providers.some((provider) => provider.id === selectedProviderId)) {
      setSelectedProviderId(
        providers.find((provider) => provider.isDefault)?.id ?? providers[0]?.id ?? null
      )
    }
  }, [providers, selectedProviderId])

  useEffect(() => {
    if (!selectedProvider) return
    setBaseUrl(selectedProvider.baseUrl)
    setModel(selectedProvider.defaultModel)
    setApiKey('')
    setTestResult(selectedProvider.lastTest)
    setModelResult(null)
    // Reset only when the operator selects a different provider.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProviderId])

  useEffect(() => {
    const section = (location.state as { section?: string } | null)?.section
    if (!section) return
    const timer = window.setTimeout(() => {
      document.getElementById(section)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 80)
    return () => window.clearTimeout(timer)
  }, [location.state])

  const loadLogs = async (): Promise<void> => {
    setLogsBusy(true)
    try {
      setLogs(await window.igris.diagnostics.logs(10))
    } catch (error) {
      notify('error', 'Could not read diagnostics', errorMessage(error))
    } finally {
      setLogsBusy(false)
    }
  }

  useEffect(() => {
    void loadLogs()
    // Diagnostics are cheap and read-only; load once when Settings opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!settings) return null

  const apply = async (patch: DeepPartial<Settings>): Promise<boolean> => {
    setSaveState('saving')
    try {
      await updateSettings(patch)
      setSaveState('saved')
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(() => setSaveState('idle'), 1800)
      return true
    } catch (error) {
      setSaveState('idle')
      notify('error', 'Could not save settings', errorMessage(error))
      return false
    }
  }

  const saveInstructions = async (): Promise<void> => {
    const ok = await apply({ ai: { systemInstructions: instructions.trim() } })
    if (ok) {
      setInstructionsDirty(false)
      notify('success', 'Assistant instructions saved')
    }
  }

  const clearHistory = async (): Promise<void> => {
    if (!clearConversations && !clearMemories) return
    setClearing(true)
    try {
      const result = await window.igris.settings.clearHistory({
        conversations: clearConversations,
        memories: clearMemories
      })
      await refreshConversations()
      newConversation()
      setClearOpen(false)
      notify(
        'success',
        'Local history cleared',
        `${plural(result.conversations, 'conversation')} and ${plural(result.memories, 'memory', 'memories')} removed.`
      )
    } catch (error) {
      notify('error', 'Could not clear history', errorMessage(error))
    } finally {
      setClearing(false)
    }
  }

  const exportData = async (): Promise<void> => {
    try {
      const result = await window.igris.settings.export()
      notify(result.ok ? 'success' : 'info', 'Data export', result.message)
    } catch (error) {
      notify('error', 'Could not export data', errorMessage(error))
    }
  }

  const revealData = async (path: string): Promise<void> => {
    try {
      await window.igris.system.revealPath(path)
    } catch (error) {
      notify('error', 'Could not reveal the folder', errorMessage(error))
    }
  }

  const revokeAll = async (): Promise<void> => {
    setResetting(true)
    const permissions = Object.fromEntries(
      PERMISSION_ORDER.map((key) => [key, false])
    ) as Record<PermissionKey, boolean>
    await apply({ permissions })
    setResetting(false)
  }

  const setPermission = (key: PermissionKey, value: boolean): void => {
    void apply({ permissions: { [key]: value } })
  }

  const saveProvider = async (): Promise<void> => {
    if (!selectedProvider) return
    setProviderSaving(true)
    try {
      const saved = await window.igris.providers.save({
        id: selectedProvider.id,
        name: selectedProvider.name,
        kind: selectedProvider.kind,
        baseUrl: baseUrl.trim() || undefined,
        defaultModel: model.trim(),
        supportsTools: selectedProvider.supportsTools,
        apiKey: apiKey.trim() || undefined
      })
      await refreshProviders()
      setApiKey('')
      setTestResult(saved.lastTest)
      notify('success', 'Provider saved', `${saved.name} · ${saved.defaultModel || 'no model'}`)
    } catch (error) {
      notify('error', 'Could not save provider', errorMessage(error))
    } finally {
      setProviderSaving(false)
    }
  }

  const testConnection = async (): Promise<void> => {
    if (!selectedProvider) return
    setTesting(true)
    setTestResult(null)
    try {
      const result = await window.igris.providers.test({
        kind: selectedProvider.kind,
        providerId: selectedProvider.id,
        baseUrl: baseUrl.trim() || undefined,
        model: model.trim() || undefined
      })
      setTestResult(result)
      await refreshProviders()
      notify(result.ok ? 'success' : 'error', result.ok ? 'Connection verified' : 'Connection failed', result.message)
    } catch (error) {
      const message = errorMessage(error)
      setTestResult({ ok: false, message, at: new Date().toISOString() })
      notify('error', 'Connection test failed', message)
    } finally {
      setTesting(false)
    }
  }

  const discoverModels = async (): Promise<void> => {
    if (!selectedProvider) return
    setDiscovering(true)
    setModelResult(null)
    try {
      const result = await window.igris.providers.models({
        kind: selectedProvider.kind,
        providerId: selectedProvider.id,
        baseUrl: baseUrl.trim() || undefined,
        model: model.trim() || undefined,
        apiKey: apiKey.trim() || undefined
      })
      setModelResult(result)
      notify(
        result.supported && result.models.length ? 'success' : 'info',
        'Model discovery',
        result.message
      )
    } catch (error) {
      setModelResult({ supported: false, models: [], message: errorMessage(error) })
    } finally {
      setDiscovering(false)
    }
  }

  const makeDefault = async (): Promise<void> => {
    if (!selectedProvider) return
    try {
      await window.igris.providers.setDefault(selectedProvider.id)
      await refreshProviders()
      setPreferredProvider(selectedProvider.id)
      notify('success', `${selectedProvider.name} is now the default provider`)
    } catch (error) {
      notify('error', 'Could not set the default provider', errorMessage(error))
    }
  }

  const makeGeminiDefault = async (): Promise<void> => {
    if (!geminiProvider) {
      navigate('/models')
      return
    }
    try {
      await window.igris.providers.setDefault(geminiProvider.id)
      await refreshProviders()
      setPreferredProvider(geminiProvider.id)
      notify('success', 'Gemini is now the default provider', 'Voice transcription can use it.')
    } catch (error) {
      notify('error', 'Could not set Gemini as default', errorMessage(error))
    }
  }

  const exportDiagnostics = async (): Promise<void> => {
    setExportingDiagnostics(true)
    try {
      const result = await window.igris.diagnostics.export()
      notify(result.ok ? 'success' : 'info', 'Diagnostics export', result.message)
    } catch (error) {
      notify('error', 'Could not export diagnostics', errorMessage(error))
    } finally {
      setExportingDiagnostics(false)
    }
  }

  const clearLogs = async (): Promise<void> => {
    setClearingLogs(true)
    try {
      await window.igris.diagnostics.clearLogs()
      await loadLogs()
      setClearLogsOpen(false)
      notify('success', 'Diagnostic logs cleared')
    } catch (error) {
      notify('error', 'Could not clear logs', errorMessage(error))
    } finally {
      setClearingLogs(false)
    }
  }

  return (
    <div className="page settings-page">
      <PageHeader
        eyebrow="SYSTEM CONFIGURATION"
        title="Settings"
        description="Providers, permissions, voice, companion behaviour and local data. Changes save instantly unless a control says otherwise."
        actions={
          <div className={clsx('save-indicator', `is-${saveState}`)}>
            {saveState === 'saved' ? (
              <Check size={12} />
            ) : saveState === 'saving' ? (
              <RefreshCw size={12} className="spin" />
            ) : (
              <Lock size={12} />
            )}
            {saveState === 'saved'
              ? 'Saved locally'
              : saveState === 'saving'
                ? 'Saving…'
                : 'local-only storage'}
          </div>
        }
      />

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {SECTION_LINKS.map((section) => {
            const Icon = section.icon
            return (
              <button
                key={section.id}
                type="button"
                onClick={() =>
                  document
                    .getElementById(section.id)
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }
              >
                <Icon size={13} />
                {section.label}
              </button>
            )
          })}
          <div className="settings-nav-foot">
            <Sparkles size={12} />
            <span>v{system?.version ?? '1.0.0'} · cloud models only</span>
          </div>
        </nav>

        <div className="settings-sections">
          <Card className="settings-card" id="settings-providers">
            <div className="settings-card-head">
              <div className="settings-card-icon">
                <Server size={16} />
              </div>
              <div>
                <h2>Providers & API keys</h2>
                <p>Keys are encrypted with Windows DPAPI and never sent to the interface.</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                icon={<Star size={13} />}
                onClick={() => void makeDefault()}
                disabled={!selectedProvider || selectedProvider.isDefault}
              >
                Set default
              </Button>
            </div>

            <div className="provider-panel">
              <div className="provider-list">
                {providers.length ? (
                  providers.map((provider) => (
                    <button
                      key={provider.id}
                      type="button"
                      className={clsx(
                        'provider-list-item',
                        provider.id === selectedProvider?.id && 'is-active'
                      )}
                      onClick={() => setSelectedProviderId(provider.id)}
                    >
                      <strong>
                        {provider.name}
                        {provider.isDefault ? ' · default' : ''}
                      </strong>
                      <small>{provider.defaultModel || 'no model selected'}</small>
                      <span className="provider-badges">
                        <span className={clsx('capability-pill', provider.hasKey ? 'is-ok' : 'is-warn')}>
                          <KeyRound size={8} />
                          {provider.hasKey ? provider.keyHint ?? 'key stored' : 'no key'}
                        </span>
                        <span className="capability-pill">{provider.kind}</span>
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="provider-empty">
                    No provider configured.
                    <br />
                    Add a cloud provider to send requests.
                  </div>
                )}
                <Button
                  variant="default"
                  size="sm"
                  icon={<Server size={13} />}
                  onClick={() => navigate('/models')}
                >
                  Manage providers
                </Button>
              </div>

              {selectedProvider ? (
                <div className="provider-form">
                  <div className="provider-form-head">
                    <strong>{selectedProvider.name}</strong>
                    <span>
                      {PROVIDER_CATALOG[selectedProvider.kind]?.label ?? selectedProvider.kind} ·{' '}
                      {selectedProvider.hasKey ? 'key stored' : 'no key stored'}
                    </span>
                  </div>

                  <Field
                    label="API key"
                    hint={
                      selectedProvider.keyHint
                        ? `Current key ${selectedProvider.keyHint}. Leave blank to keep it.`
                        : 'Required for most providers. Stored with DPAPI.'
                    }
                  >
                    <Input
                      type="password"
                      value={apiKey}
                      onChange={(event) => setApiKey(event.target.value)}
                      placeholder={selectedProvider.hasKey ? '••••••••  unchanged' : 'Paste a cloud API key'}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </Field>

                  <div className="provider-form-row">
                    <Field label="Default model" hint="Used for new conversations and terminal requests.">
                      <Input
                        value={model}
                        onChange={(event) => setModel(event.target.value)}
                        placeholder="provider default"
                        spellCheck={false}
                      />
                    </Field>
                    <Field label="Base URL" hint="Only custom OpenAI-compatible endpoints need this.">
                      <Input
                        value={baseUrl}
                        onChange={(event) => setBaseUrl(event.target.value)}
                        placeholder="https://api.example.com/v1"
                        spellCheck={false}
                      />
                    </Field>
                  </div>

                  <div className="provider-form-actions">
                    <Button
                      variant="primary"
                      size="sm"
                      icon={<KeyRound size={13} />}
                      onClick={() => void saveProvider()}
                      loading={providerSaving}
                    >
                      Save provider
                    </Button>
                    <Button
                      variant="default"
                      size="sm"
                      icon={<Wifi size={13} />}
                      onClick={() => void testConnection()}
                      loading={testing}
                    >
                      Test connection
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<RefreshCw size={13} />}
                      onClick={() => void discoverModels()}
                      loading={discovering}
                    >
                      Discover models
                    </Button>
                  </div>

                  {testResult ? (
                    <div className={clsx('provider-test-result', testResult.ok ? 'is-ok' : 'is-error')}>
                      {testResult.ok ? <Check size={12} /> : <Wifi size={12} />}
                      <span>
                        {testResult.message}
                        {testResult.latencyMs ? ` · ${testResult.latencyMs} ms` : ''} ·{' '}
                        {relativeTime(testResult.at)}
                      </span>
                    </div>
                  ) : null}

                  {modelResult ? (
                    <div className="provider-form">
                      <div className="provider-form-head">
                        <strong>Model discovery</strong>
                        <span>{modelResult.models.length} found</span>
                      </div>
                      <p className="settings-fineprint">{modelResult.message}</p>
                      {modelResult.models.length ? (
                        <Select
                          value={modelResult.models.includes(model) ? model : ''}
                          onChange={(event) => setModel(event.target.value)}
                        >
                          <option value="">Select a discovered model</option>
                          {modelResult.models.slice(0, 60).map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </Select>
                      ) : null}
                    </div>
                  ) : null}

                  <p className="settings-fineprint">
                    After saving, test the connection. The terminal refuses requests when no key or
                    model is available.
                  </p>
                </div>
              ) : null}
            </div>
          </Card>

          <Card className="settings-card" id="settings-intelligence">
            <div className="settings-card-head">
              <div className="settings-card-icon">
                <SlidersHorizontal size={16} />
              </div>
              <div>
                <h2>Intelligence</h2>
                <p>How responses are assembled and when tools may run.</p>
              </div>
            </div>

            <div className="settings-grid-2">
              <Slider
                label="Temperature"
                value={settings.ai.temperature}
                min={0}
                max={2}
                step={0.1}
                valueLabel={settings.ai.temperature.toFixed(1)}
                onChange={(value) => void apply({ ai: { temperature: value } })}
              />
              <Slider
                label="Context messages"
                value={settings.ai.contextMessages}
                min={4}
                max={80}
                step={1}
                valueLabel={settings.ai.contextMessages}
                onChange={(value) => void apply({ ai: { contextMessages: value } })}
              />
              <Slider
                label="Max tool iterations"
                value={settings.ai.maxToolIterations}
                min={1}
                max={12}
                step={1}
                valueLabel={settings.ai.maxToolIterations}
                onChange={(value) => void apply({ ai: { maxToolIterations: value } })}
              />
              <div className="settings-micro">
                <span>Streaming</span>
                <Toggle
                  checked={settings.ai.streaming}
                  onChange={(value) => void apply({ ai: { streaming: value } })}
                  label="Stream tokens as they arrive"
                />
              </div>
            </div>

            <div className="settings-toggle-list">
              <Toggle
                checked={settings.ai.confirmSensitiveActions}
                onChange={(value) => void apply({ ai: { confirmSensitiveActions: value } })}
                label="Confirm sensitive actions"
                description="Strongly recommended. High-risk tools always require explicit approval."
                tone="danger"
              />
            </div>

            <Field
              label="System instructions"
              hint="Included in every conversation. Do not paste secrets. Saved on demand."
            >
              <Textarea
                value={instructions}
                onChange={(event) => {
                  setInstructions(event.target.value)
                  setInstructionsDirty(event.target.value.trim() !== settings.ai.systemInstructions)
                }}
                rows={4}
                placeholder="Optional guidance for tone, working style or standing preferences."
                maxLength={8000}
              />
            </Field>
            <div className="settings-inline-actions">
              <Button
                variant="primary"
                size="sm"
                onClick={() => void saveInstructions()}
                disabled={!instructionsDirty}
                loading={saveState === 'saving'}
              >
                Save instructions
              </Button>
              <span className="settings-inline-note">
                {instructions.length.toLocaleString()} / 8,000 characters
              </span>
            </div>
          </Card>

          <Card className="settings-card" id="settings-permissions">
            <div className="settings-card-head">
              <div className="settings-card-icon">
                <ShieldCheck size={16} />
              </div>
              <div>
                <h2>Permissions</h2>
                <p>Capabilities fail closed. Sensitive actions still require per-call approval.</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => void revokeAll()} loading={resetting}>
                Revoke all
              </Button>
            </div>

            <Alert tone="warning" title="You are granting real access">
              File writes create backups, terminal commands are allowlisted, and launch targets are
              fixed. Computer control can move your mouse and type in other apps, but only inside a
              task you explicitly approve. These safeguards reduce risk but do not replace your
              review.
            </Alert>

            <div className="permission-settings">
              {PERMISSION_ORDER.map((key) => {
                const meta = PERMISSION_META[key]
                return (
                  <Toggle
                    key={key}
                    checked={settings.permissions[key]}
                    onChange={(value) => setPermission(key, value)}
                    label={
                      <span className="permission-settings-label">
                        {meta.label}
                        {meta.sensitive ? (
                          <span className="permission-sensitive">Sensitive</span>
                        ) : null}
                      </span>
                    }
                    description={meta.description}
                    tone={meta.sensitive ? 'danger' : 'default'}
                  />
                )
              })}
            </div>

            {settings.permissions.desktopControl || settings.permissions.browserControl ? (
              <Alert tone="danger" title="Computer control is enabled">
                Each task still needs its own approval. During an approved task IGRIS can see the
                screen, click, type and drive its own Edge profile. Password fields, UAC/elevated
                windows, IGRIS windows, downloads and uploads stay blocked. Press Ctrl+Alt+Shift+X
                or the Stop button to end control immediately.
              </Alert>
            ) : null}
          </Card>

          <Card className="settings-card" id="settings-voice">
            <div className="settings-card-head">
              <div className="settings-card-icon">
                <Mic size={16} />
              </div>
              <div>
                <h2>Voice</h2>
                <p>Microphone transcription in the terminal and the conversation composer.</p>
              </div>
              <Badge tone={voiceReady ? 'success' : 'warning'} dot>
                {voiceReady ? 'ready' : 'setup required'}
              </Badge>
            </div>

            <div className="settings-toggle-list">
              <Toggle
                checked={settings.permissions.voice}
                onChange={(value) => setPermission('voice', value)}
                label="Allow microphone access"
                description="Records only while you hold the voice capture, then sends the audio to the default Gemini provider for transcription."
              />
            </div>

            <div className="settings-row">
              <div className="settings-row-copy">
                <strong>Transcription provider</strong>
                <p>
                  {defaultProvider
                    ? defaultProvider.kind === 'gemini'
                      ? `${defaultProvider.name} is ready for voice.`
                      : `${defaultProvider.name} is the default. Voice requires Gemini.`
                    : 'No provider configured.'}
                </p>
              </div>
              <Button
                variant="default"
                size="sm"
                icon={<Mic size={13} />}
                onClick={() => void makeGeminiDefault()}
                disabled={defaultProvider?.kind === 'gemini'}
              >
                {geminiProvider ? 'Use Gemini' : 'Add Gemini'}
              </Button>
            </div>

            <p className="settings-fineprint">
              Voice fails closed when the permission is off or the default provider is not Gemini.
              Audio is not stored after transcription.
            </p>
          </Card>

          <Card className="settings-card" id="settings-companion">
            <div className="settings-card-head">
              <div className="settings-card-icon">
                <Monitor size={16} />
              </div>
              <div>
                <h2>Companion</h2>
                <p>Desktop presence, tray behaviour and the mini robot launcher.</p>
              </div>
            </div>

            <div className="settings-toggle-list">
              <Toggle
                checked={settings.desktop.launchAtStartup}
                onChange={(value) => void apply({ desktop: { launchAtStartup: value } })}
                label="Launch IGRIS with Windows"
                description="Only takes effect in an installed build, not the development preview."
              />
              <Toggle
                checked={settings.desktop.closeToTray}
                onChange={(value) => void apply({ desktop: { closeToTray: value } })}
                label="Close to the system tray"
                description="Keep the local core running when the main window closes. The mini robot launcher appears when IGRIS is minimized."
              />
            </div>

            <div className="settings-divider" />

            <div className="settings-row">
              <div className="settings-row-copy">
                <strong>3D companion</strong>
                <p>The Home terminal robot reacts to idle, listening, thinking, execution and approval states.</p>
              </div>
              <Toggle
                checked={settings.appearance.show3d}
                onChange={(value) => void apply({ appearance: { show3d: value } })}
                label="Render 3D"
              />
            </div>

            <div className="settings-row">
              <div className="settings-row-copy">
                <strong>Render quality</strong>
                <p>Resolution for the companion and any remaining 3D surfaces.</p>
              </div>
              <SegmentedControl
                value={settings.appearance.quality}
                onChange={(value) => void apply({ appearance: { quality: value } })}
                options={[
                  { value: 'low', label: 'Low' },
                  { value: 'medium', label: 'Balanced' },
                  { value: 'high', label: 'High' }
                ]}
                ariaLabel="Render quality"
              />
            </div>

            <div className="settings-row">
              <div className="settings-row-copy">
                <strong>Animation intensity</strong>
                <p>Calm for focus, lively for presence.</p>
              </div>
              <SegmentedControl
                value={settings.appearance.animationIntensity}
                onChange={(value) => void apply({ appearance: { animationIntensity: value } })}
                options={[
                  { value: 'calm', label: 'Calm' },
                  { value: 'balanced', label: 'Balanced' },
                  { value: 'lively', label: 'Lively' }
                ]}
                ariaLabel="Animation intensity"
              />
            </div>

            <div className="settings-toggle-list">
              <Toggle
                checked={settings.appearance.reducedMotion}
                onChange={(value) => void apply({ appearance: { reducedMotion: value } })}
                label="Reduce motion"
                description="Dampens robot movement and disables ambient motion."
              />
            </div>
          </Card>

          <Card className="settings-card" id="settings-appearance">
            <div className="settings-card-head">
              <div className="settings-card-icon">
                <Palette size={16} />
              </div>
              <div>
                <h2>Appearance</h2>
                <p>Accent identity. The terminal surface stays dark and monospaced.</p>
              </div>
            </div>

            <div className="settings-block">
              <div className="settings-label">Accent identity</div>
              <div className="accent-options">
                {(
                  [
                    ['azure', 'Electric azure', '#67e8f9'],
                    ['violet', 'Ultraviolet', '#a78bfa'],
                    ['silver', 'Titanium silver', '#d4deea']
                  ] as const
                ).map(([value, label, color]) => (
                  <button
                    key={value}
                    type="button"
                    className={clsx(
                      'accent-option',
                      settings.appearance.accent === value && 'is-active'
                    )}
                    onClick={() => void apply({ appearance: { accent: value } })}
                  >
                    <span className="accent-swatch" style={{ backgroundColor: color }} />
                    <span>{label}</span>
                    {settings.appearance.accent === value ? <Check size={12} /> : null}
                  </button>
                ))}
              </div>
            </div>
          </Card>

          <Card className="settings-card" id="settings-privacy">
            <div className="settings-card-head">
              <div className="settings-card-icon">
                <Lock size={16} />
              </div>
              <div>
                <h2>Privacy & data</h2>
                <p>Nothing leaves this machine unless a provider call requires it.</p>
              </div>
            </div>

            <div className="settings-toggle-list">
              <Toggle
                checked={settings.privacy.saveConversations}
                onChange={(value) => void apply({ privacy: { saveConversations: value } })}
                label="Save conversations locally"
                description="When disabled, conversations are cleared when IGRIS shuts down."
              />
              <Toggle
                checked={settings.privacy.diagnostics}
                onChange={(value) => void apply({ privacy: { diagnostics: value } })}
                label="Write diagnostic logs"
                description="Scoped runtime events with secrets and file contents redacted."
              />
            </div>

            <Field label="Conversation retention" hint="Zero keeps history until you clear it manually.">
              <Select
                value={String(settings.privacy.retentionDays)}
                onChange={(event) =>
                  void apply({ privacy: { retentionDays: Number(event.target.value) } })
                }
              >
                <option value="0">Keep indefinitely</option>
                <option value="7">Delete after 7 days</option>
                <option value="14">Delete after 14 days</option>
                <option value="30">Delete after 30 days</option>
                <option value="90">Delete after 90 days</option>
                <option value="365">Delete after 1 year</option>
              </Select>
            </Field>

            <div className="settings-data-actions">
              <Button
                variant="default"
                size="sm"
                icon={<Download size={13} />}
                onClick={() => void exportData()}
              >
                Export local data
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon={<Database size={13} />}
                onClick={() => void revealData(system?.userDataPath ?? '')}
                disabled={!system}
              >
                Open data folder
              </Button>
              <Button
                variant="danger"
                size="sm"
                icon={<Trash2 size={13} />}
                onClick={() => setClearOpen(true)}
              >
                Clear history
              </Button>
            </div>
            <p className="settings-fineprint">
              Exports include conversations, memories, tasks and settings — never API keys.
            </p>
          </Card>

          <Card className="settings-card" id="settings-diagnostics">
            <div className="settings-card-head">
              <div className="settings-card-icon">
                <Activity size={16} />
              </div>
              <div>
                <h2>Diagnostics</h2>
                <p>Local health checks, scoped logs and audit-friendly exports.</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                icon={<RefreshCw size={12} />}
                onClick={() => void loadLogs()}
                loading={logsBusy}
              >
                Refresh
              </Button>
            </div>

            <div className="settings-grid-2">
              {health?.checks.map((check) => (
                <div key={check.id} className="settings-row">
                  <div className="settings-row-copy">
                    <strong>
                      <span className={clsx('pulse-dot', `is-${check.status}`)} /> {check.label}
                    </strong>
                    <p>{check.detail}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="settings-inline-actions">
              <Button
                variant="default"
                size="sm"
                icon={<Download size={13} />}
                onClick={() => void exportDiagnostics()}
                loading={exportingDiagnostics}
              >
                Export diagnostics
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon={<Trash2 size={13} />}
                onClick={() => setClearLogsOpen(true)}
                disabled={!logs.length}
              >
                Clear logs
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon={<Activity size={13} />}
                onClick={() => navigate('/activity')}
              >
                Open activity
              </Button>
            </div>

            <div className="provider-form">
              <div className="provider-form-head">
                <strong>Recent log entries</strong>
                <span>{logs.length} shown</span>
              </div>
              {logs.length ? (
                <div className="tw-list">
                  {logs.map((entry) => (
                    <div key={entry.id} className="tw-list-row">
                      <span className="tw-list-main">
                        <strong>
                          [{entry.level}] {entry.scope}
                        </strong>
                        <small>{entry.message}</small>
                      </span>
                      <span className="tw-list-meta">{relativeTime(entry.createdAt)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="settings-fineprint">
                  No diagnostic entries. Enable diagnostic logs under Privacy & data.
                </p>
              )}
            </div>
          </Card>

          <Card className="settings-card" id="settings-about">
            <div className="settings-card-head">
              <div className="settings-card-icon">
                <Info size={16} />
              </div>
              <div>
                <h2>About IGRIS</h2>
                <p>Runtime facts, local paths and setup.</p>
              </div>
              <Badge tone="accent">v{system?.version ?? '1.0.0'}</Badge>
            </div>

            <div className="about-grid">
              <div className="about-kv">
                <KeyValue label="Application">{system?.appName ?? 'IGRIS'}</KeyValue>
                <KeyValue label="Version">{system?.version ?? '—'}</KeyValue>
                <KeyValue label="Electron">{system?.electron ?? '—'}</KeyValue>
                <KeyValue label="Chromium">{system?.chrome ?? '—'}</KeyValue>
                <KeyValue label="Node">{system?.node ?? '—'}</KeyValue>
                <KeyValue label="Platform">
                  {system ? `${system.platform} ${system.arch}` : '—'}
                </KeyValue>
              </div>
              <div className="about-kv">
                <KeyValue label="Started">{system ? fullTime(system.startedAt) : '—'}</KeyValue>
                <KeyValue label="Provider">{health?.activeProvider ?? 'None'}</KeyValue>
                <KeyValue label="Database">{health ? formatBytes(health.databaseBytes) : '-'}</KeyValue>
                <KeyValue label="Web browsing">
                  {settings.permissions.browser ? 'Default browser' : 'Off'}
                </KeyValue>
                <KeyValue label="Mode">
                  {system?.isPackaged ? 'Installed build' : 'Development'}
                </KeyValue>
                <KeyValue label="Models">Cloud only · no local runtime</KeyValue>
              </div>
            </div>

            <Field label="Local data path">
              <div className="path-readout">
                <code>{system?.userDataPath ?? 'Unavailable'}</code>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<FolderOpen size={12} />}
                  onClick={() => void revealData(system?.userDataPath ?? '')}
                >
                  Reveal
                </Button>
              </div>
            </Field>

            <div className="settings-inline-actions">
              <Button
                variant="default"
                size="sm"
                icon={<Wand2 size={13} />}
                onClick={openOnboarding}
              >
                Replay setup guide
              </Button>
              <span className="settings-inline-note">
                Resets nothing; opens the four-step orientation again.
              </span>
            </div>

            <div className="about-footer">
              <span>
                <ShieldCheck size={11} /> Cloud-only AI · no local model runtime
              </span>
              <span>
                <Lock size={11} /> Credentials protected by Windows DPAPI
              </span>
            </div>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={clearOpen}
        title="Clear local history?"
        description={
          <div className="clear-history-body">
            <p>This permanently removes selected records from the local database.</p>
            <Toggle
              checked={clearConversations}
              onChange={setClearConversations}
              label="All conversations and messages"
            />
            <Toggle
              checked={clearMemories}
              onChange={setClearMemories}
              label="Saved memories"
            />
            <p className="clear-history-note">
              Settings, providers and stored API keys are not affected. Stop active responses
              before clearing.
            </p>
          </div>
        }
        confirmLabel="Clear selected history"
        busy={clearing}
        onCancel={() => setClearOpen(false)}
        onConfirm={() => void clearHistory()}
      />

      <ConfirmDialog
        open={clearLogsOpen}
        title="Clear diagnostic logs?"
        description="Removes local scoped log entries. Conversations, memories and provider keys are untouched."
        confirmLabel="Clear logs"
        busy={clearingLogs}
        onCancel={() => setClearLogsOpen(false)}
        onConfirm={() => void clearLogs()}
      />
    </div>
  )
}
