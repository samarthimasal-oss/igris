import { useEffect, useMemo, useState } from 'react'
import {
  Check,
  CheckCircle2,
  Cpu,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  Wifi,
  XCircle
} from 'lucide-react'
import { PROVIDER_CATALOG, PROVIDER_ORDER } from '@shared/defaults'
import type {
  ModelListResult,
  ProviderDraft,
  ProviderDto,
  ProviderInput,
  ProviderKind,
  ProviderTestResult
} from '@shared/types'
import { useAppStore } from '../lib/store'
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  IconButton,
  Input,
  PageHeader,
  Select,
  Spinner,
  Toggle
} from '../components/ui'
import { errorHint, errorMessage } from '../lib/errors'
import { providerLabel, relativeTime } from '../lib/format'
import clsx from 'clsx'

const MONOGRAM: Record<ProviderKind, string> = {
  openai: 'OA',
  anthropic: 'AN',
  gemini: 'GE',
  'openai-compatible': 'API'
}

interface CardTestState {
  id: string
  result: ProviderTestResult | null
  error: string | null
}

export function ModelsPage() {
  const providers = useAppStore((state) => state.providers)
  const refreshProviders = useAppStore((state) => state.refreshProviders)
  const notify = useAppStore((state) => state.notify)

  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [kind, setKind] = useState<ProviderKind>('openai')
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [supportsTools, setSupportsTools] = useState(true)
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null)
  const [modelResult, setModelResult] = useState<ModelListResult | null>(null)
  const [cardTest, setCardTest] = useState<CardTestState | null>(null)
  const [removing, setRemoving] = useState<ProviderDto | null>(null)
  const [clearing, setClearing] = useState<ProviderDto | null>(null)
  const [busy, setBusy] = useState(false)

  const editing = providers.find((provider) => provider.id === editingId) ?? null
  const editorOpen = creating || Boolean(editing)
  const catalog = PROVIDER_CATALOG[kind]
  const defaultProvider = providers.find((provider) => provider.isDefault) ?? providers[0] ?? null

  const clearEditor = (): void => {
    setCreating(false)
    setEditingId(null)
    setApiKey('')
    setTestResult(null)
    setModelResult(null)
    setShowKey(false)
  }

  const startCreate = (initialKind: ProviderKind = 'openai'): void => {
    const entry = PROVIDER_CATALOG[initialKind]
    setCreating(true)
    setEditingId(null)
    setKind(initialKind)
    setName(entry.label)
    setBaseUrl(entry.defaultBaseUrl)
    setApiKey('')
    setModel('')
    setSupportsTools(true)
    setTestResult(null)
    setModelResult(null)
    setShowKey(false)
  }

  const startEdit = (provider: ProviderDto): void => {
    setCreating(false)
    setEditingId(provider.id)
    setKind(provider.kind)
    setName(provider.name)
    setBaseUrl(provider.baseUrl)
    setApiKey('')
    setModel(provider.defaultModel)
    setSupportsTools(provider.supportsTools)
    setTestResult(provider.lastTest)
    setModelResult(null)
    setShowKey(false)
  }

  const changeKind = (next: ProviderKind): void => {
    const entry = PROVIDER_CATALOG[next]
    const previous = PROVIDER_CATALOG[kind]
    setKind(next)
    if (creating && (!name.trim() || name === previous.label)) setName(entry.label)
    if (!editing || editing.kind === next) {
      if (!baseUrl.trim() || baseUrl === previous.defaultBaseUrl) setBaseUrl(entry.defaultBaseUrl)
    }
    setTestResult(null)
    setModelResult(null)
  }

  useEffect(() => {
    void refreshProviders()
  }, [refreshProviders])

  const draft: ProviderDraft = useMemo(
    () => ({
      kind,
      providerId: editingId ?? undefined,
      baseUrl: catalog.allowsCustomBaseUrl ? baseUrl.trim() || undefined : undefined,
      apiKey: apiKey.trim() ? apiKey.trim() : undefined,
      model: model.trim() || undefined
    }),
    [kind, editingId, catalog.allowsCustomBaseUrl, baseUrl, apiKey, model]
  )

  const save = async (): Promise<void> => {
    if (!name.trim()) {
      notify('warning', 'Name required', 'Give this provider a recognisable name.')
      return
    }
    setSaving(true)
    try {
      const input: ProviderInput = {
        id: editingId ?? undefined,
        name: name.trim(),
        kind,
        baseUrl: catalog.allowsCustomBaseUrl ? baseUrl.trim() || undefined : undefined,
        defaultModel: model.trim(),
        supportsTools
      }
      if (apiKey.trim()) input.apiKey = apiKey.trim()
      const saved = await window.igris.providers.save(input)
      await refreshProviders()
      notify('success', editing ? 'Provider updated' : 'Provider connected', saved.name)
      clearEditor()
    } catch (error) {
      notify('error', 'Could not save provider', `${errorMessage(error)} ${errorHint(error) ?? ''}`.trim())
    } finally {
      setSaving(false)
    }
  }

  const testConnection = async (target?: ProviderDto): Promise<void> => {
    const targetDraft: ProviderDraft = target
      ? { kind: target.kind, providerId: target.id, model: target.defaultModel || undefined }
      : draft
    if (target) setCardTest({ id: target.id, result: null, error: null })
    else setTesting(true)
    try {
      const result = await window.igris.providers.test(targetDraft)
      if (target) setCardTest({ id: target.id, result, error: null })
      else setTestResult(result)
      await refreshProviders()
      notify(
        result.ok ? 'success' : 'error',
        result.ok ? 'Connection verified' : 'Connection test failed',
        result.message
      )
    } catch (error) {
      const message = `${errorMessage(error)} ${errorHint(error) ?? ''}`.trim()
      if (target) setCardTest({ id: target.id, result: null, error: message })
      else setTestResult({ ok: false, message, at: new Date().toISOString() })
      notify('error', 'Connection test failed', message)
    } finally {
      setTesting(false)
    }
  }

  const fetchModels = async (): Promise<void> => {
    setFetching(true)
    setModelResult(null)
    try {
      const result = await window.igris.providers.models(draft)
      setModelResult(result)
      notify(
        result.supported && result.models.length ? 'success' : 'info',
        'Model discovery',
        result.message
      )
    } catch (error) {
      setModelResult({
        supported: false,
        models: [],
        message: `${errorMessage(error)} ${errorHint(error) ?? ''}`.trim()
      })
    } finally {
      setFetching(false)
    }
  }

  const makeDefault = async (provider: ProviderDto): Promise<void> => {
    try {
      await window.igris.providers.setDefault(provider.id)
      await refreshProviders()
      notify('success', `${provider.name} is now the default provider`)
    } catch (error) {
      notify('error', 'Could not change the default provider', errorMessage(error))
    }
  }

  const removeProvider = async (): Promise<void> => {
    if (!removing) return
    setBusy(true)
    try {
      await window.igris.providers.remove(removing.id)
      if (editingId === removing.id) clearEditor()
      await refreshProviders()
      notify('success', 'Provider removed', removing.name)
      setRemoving(null)
    } catch (error) {
      notify('error', 'Could not remove provider', errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const clearStoredKey = async (): Promise<void> => {
    if (!clearing) return
    setBusy(true)
    try {
      await window.igris.providers.save({
        id: clearing.id,
        name: clearing.name,
        kind: clearing.kind,
        baseUrl: clearing.baseUrl,
        defaultModel: clearing.defaultModel,
        supportsTools: clearing.supportsTools,
        apiKey: ''
      })
      await refreshProviders()
      notify('success', 'Stored key cleared', `${clearing.name} will require a new key before use.`)
      setClearing(null)
    } catch (error) {
      notify('error', 'Could not clear the key', errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const availableModels = modelResult?.models ?? []

  return (
    <div className="page models-page">
      <PageHeader
        eyebrow="Intelligence layer"
        title="AI models"
        description="Bring your own cloud models. Keys are encrypted with Windows DPAPI and never leave the main process."
        actions={
          <>
            <Button
              variant="ghost"
              icon={<RefreshCw size={15} />}
              onClick={() => void refreshProviders()}
            >
              Refresh
            </Button>
            <Button variant="primary" icon={<Plus size={15} />} onClick={() => startCreate()}>
              Add provider
            </Button>
          </>
        }
      />

      <div className="models-summary">
        <div className="models-summary-item">
          <span className="models-summary-icon"><Server size={16} /></span>
          <div>
            <strong>{providers.length}</strong>
            <span>provider{providers.length === 1 ? '' : 's'}</span>
          </div>
        </div>
        <div className="models-summary-item">
          <span className="models-summary-icon"><Star size={16} /></span>
          <div>
            <strong>{defaultProvider?.name ?? 'None'}</strong>
            <span>{defaultProvider?.defaultModel ?? 'default provider'}</span>
          </div>
        </div>
        <div className="models-summary-item">
          <span className="models-summary-icon"><ShieldCheck size={16} /></span>
          <div>
            <strong>DPAPI</strong>
            <span>credentials at rest</span>
          </div>
        </div>
      </div>

      <div className={clsx('models-layout', editorOpen && 'has-editor')}>
        <div className="provider-list">
          {providers.length ? (
            providers.map((provider) => {
              const test = cardTest?.id === provider.id ? cardTest : null
              const lastTest = test?.result ?? provider.lastTest
              return (
                <Card
                  key={provider.id}
                  className={clsx('provider-card', provider.isDefault && 'is-default')}
                >
                  <div className="provider-card-head">
                    <span className={clsx('provider-monogram', `kind-${provider.kind}`)}>
                      {MONOGRAM[provider.kind]}
                    </span>
                    <div className="provider-card-title">
                      <div>
                        <h3>{provider.name}</h3>
                        {provider.isDefault ? <Badge tone="accent">Default</Badge> : null}
                      </div>
                      <p>{providerLabel(provider.kind)} endpoint</p>
                    </div>
                    <div className="provider-card-status">
                      {lastTest ? (
                        <Badge tone={lastTest.ok ? 'success' : 'danger'} dot>
                          {lastTest.ok ? 'Verified' : 'Failed'}
                        </Badge>
                      ) : (
                        <Badge tone="neutral" dot>
                          Untested
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div className="provider-model-row">
                    <span className="provider-model-label">Model</span>
                    <span className={clsx('provider-model', !provider.defaultModel && 'is-missing')}>
                      {provider.defaultModel || 'No model selected'}
                    </span>
                    <span className="provider-key">
                      <KeyRound size={12} />
                      {provider.hasKey ? provider.keyHint ?? 'Stored' : 'No key'}
                    </span>
                  </div>

                  <div className="provider-meta-row">
                    <span title={provider.baseUrl}>{provider.baseUrl}</span>
                    <span>{provider.supportsTools ? 'Tool calling' : 'Text only'}</span>
                    <span>Updated {relativeTime(provider.updatedAt)}</span>
                  </div>

                  {lastTest ? (
                    <div className={clsx('provider-test-line', lastTest.ok ? 'is-ok' : 'is-fail')}>
                      {lastTest.ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                      <span>{lastTest.message}</span>
                      {lastTest.latencyMs ? <span>{lastTest.latencyMs} ms</span> : null}
                    </div>
                  ) : null}
                  {test?.error ? (
                    <div className="provider-test-line is-fail">
                      <XCircle size={13} />
                      <span>{test.error}</span>
                    </div>
                  ) : null}

                  <div className="provider-card-actions">
                    {!provider.isDefault ? (
                      <Button variant="ghost" size="sm" icon={<Star size={13} />} onClick={() => void makeDefault(provider)}>
                        Make default
                      </Button>
                    ) : (
                      <span className="provider-default-note">
                        <Star size={12} /> Requests route here by default
                      </span>
                    )}
                    <div className="provider-action-group">
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<Wifi size={13} />}
                        onClick={() => void testConnection(provider)}
                        loading={cardTest?.id === provider.id && !cardTest.result && !cardTest.error}
                      >
                        Test
                      </Button>
                      <Button variant="default" size="sm" icon={<Pencil size={13} />} onClick={() => startEdit(provider)}>
                        Edit
                      </Button>
                      <IconButton label="Remove provider" size="sm" onClick={() => setRemoving(provider)}>
                        <Trash2 size={13} />
                      </IconButton>
                    </div>
                  </div>
                </Card>
              )
            })
          ) : (
            <Card className="provider-empty">
              <EmptyState
                icon={Cpu}
                title="No cloud provider yet"
                description="Connect OpenAI, Anthropic, Gemini, or an OpenAI-compatible endpoint. IGRIS does not run local models."
                action={
                  <Button variant="primary" icon={<Plus size={15} />} onClick={() => startCreate()}>
                    Connect a provider
                  </Button>
                }
              />
            </Card>
          )}

          {providers.length && !editorOpen ? (
            <button type="button" className="provider-add-card" onClick={() => startCreate()}>
              <Plus size={18} />
              <span>Add another provider</span>
              <small>Different account, endpoint, or model family</small>
            </button>
          ) : null}

          <Card className="provider-security">
            <div className="provider-security-head">
              <span className="provider-security-icon"><Lock size={16} /></span>
              <div>
                <strong>Credential isolation</strong>
                <p>Keys are encrypted at rest and never passed to the interface after saving.</p>
              </div>
            </div>
            <ul>
              <li>Windows DPAPI encryption bound to your user account</li>
              <li>Keys are redacted from logs and exported data</li>
              <li>Connection tests call the provider directly from the main process</li>
              <li>No local model runtime and no silent fallback provider</li>
            </ul>
          </Card>
        </div>

        <aside className="provider-editor-column">
          {editorOpen ? (
            <Card className="provider-editor">
              <div className="provider-editor-head">
                <div>
                  <span className="eyebrow">{editing ? 'Edit provider' : 'New connection'}</span>
                  <h2>{editing ? editing.name : 'Connect a mind'}</h2>
                </div>
                <button type="button" className="link-button" onClick={clearEditor}>
                  Close
                </button>
              </div>

              <div className="provider-kind-grid" role="radiogroup" aria-label="Provider type">
                {PROVIDER_ORDER.map((entry) => {
                  const item = PROVIDER_CATALOG[entry]
                  return (
                    <button
                      key={entry}
                      type="button"
                      className={clsx('provider-kind', kind === entry && 'is-active')}
                      onClick={() => changeKind(entry)}
                      disabled={Boolean(editing) && editing?.kind !== entry}
                      role="radio"
                      aria-checked={kind === entry}
                    >
                      <span>{MONOGRAM[entry]}</span>
                      <strong>{item.shortLabel}</strong>
                    </button>
                  )
                })}
              </div>
              {editing ? (
                <p className="provider-kind-note">
                  To change API type, create a new provider. Existing keys are bound to their kind.
                </p>
              ) : null}

              <Field label="Display name" htmlFor="provider-name">
                <Input
                  id="provider-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="My OpenAI account"
                  maxLength={80}
                />
              </Field>

              <Field
                label="Base URL"
                htmlFor="provider-base"
                hint={
                  catalog.allowsCustomBaseUrl
                    ? 'Use an HTTPS endpoint that implements the expected API.'
                    : 'Managed by the provider; custom endpoints are not accepted for this type.'
                }
              >
                <Input
                  id="provider-base"
                  value={catalog.allowsCustomBaseUrl ? baseUrl : catalog.defaultBaseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  disabled={!catalog.allowsCustomBaseUrl}
                  placeholder="https://api.example.com/v1"
                  spellCheck={false}
                />
              </Field>

              <Field
                label={
                  <span className="field-label-with-note">
                    API key
                    <span>{catalog.requiresKey ? 'Required' : 'Optional'}</span>
                  </span>
                }
                htmlFor="provider-key"
                hint={
                  editing?.hasKey
                    ? `A key is stored (${editing.keyHint ?? 'hidden'}). Leave blank to keep it, or enter a replacement.`
                    : catalog.authNote
                }
              >
                <div className="key-input">
                  <KeyRound size={14} className="key-input-icon" />
                  <Input
                    id="provider-key"
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder={editing?.hasKey ? 'Leave blank to keep the saved key' : 'Paste the provider API key'}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <IconButton
                    label={showKey ? 'Hide key' : 'Show key'}
                    size="sm"
                    onClick={() => setShowKey((value) => !value)}
                  >
                    {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                  </IconButton>
                </div>
              </Field>

              <Field
                label="Default model"
                htmlFor="provider-model"
                hint={catalog.placeholderModel}
              >
                <div className="model-input-row">
                  <Input
                    id="provider-model"
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                    placeholder="Model ID"
                    list="igris-model-options"
                    spellCheck={false}
                  />
                  {availableModels.length ? (
                    <datalist id="igris-model-options">
                      {availableModels.map((item) => (
                        <option key={item} value={item} />
                      ))}
                    </datalist>
                  ) : null}
                  <Button
                    variant="default"
                    size="sm"
                    icon={<RefreshCw size={13} />}
                    onClick={() => void fetchModels()}
                    loading={fetching}
                    disabled={catalog.requiresKey && !apiKey.trim() && !editing?.hasKey}
                  >
                    Fetch
                  </Button>
                </div>
              </Field>

              {catalog.toolSupport === 'configurable' ? (
                <Toggle
                  checked={supportsTools}
                  onChange={setSupportsTools}
                  label="Endpoint supports tool calling"
                  description="Enable only if the endpoint implements OpenAI-compatible function calling."
                />
              ) : null}

              {modelResult ? (
                <div className={clsx('model-discovery', !modelResult.supported && 'is-warning')}>
                  <div className="model-discovery-head">
                    <span>{modelResult.message}</span>
                    {fetching ? <Spinner size={13} /> : null}
                  </div>
                  {availableModels.length ? (
                    <div className="model-chip-list">
                      {availableModels.slice(0, 80).map((item) => (
                        <button
                          key={item}
                          type="button"
                          className={clsx('model-chip', model === item && 'is-active')}
                          onClick={() => setModel(item)}
                        >
                          {model === item ? <Check size={11} /> : null}
                          {item}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {testResult ? (
                <div className={clsx('test-result', testResult.ok ? 'is-ok' : 'is-fail')}>
                  {testResult.ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                  <div>
                    <strong>{testResult.ok ? 'Connection verified' : 'Connection failed'}</strong>
                    <p>{testResult.message}</p>
                    {testResult.latencyMs ? <small>{testResult.latencyMs} ms round trip</small> : null}
                  </div>
                </div>
              ) : null}

              <div className="provider-editor-actions">
                <Button
                  variant="default"
                  icon={<Wifi size={14} />}
                  onClick={() => void testConnection()}
                  loading={testing}
                >
                  Test connection
                </Button>
                <Button
                  variant="primary"
                  icon={<Sparkles size={14} />}
                  onClick={() => void save()}
                  loading={saving}
                >
                  {editing ? 'Save changes' : 'Save provider'}
                </Button>
              </div>

              {editing?.hasKey ? (
                <button type="button" className="danger-link" onClick={() => setClearing(editing)}>
                  <Trash2 size={12} />
                  Remove stored key
                </button>
              ) : null}

              <a
                className="provider-docs-link"
                href={catalog.docsUrl}
                onClick={(event) => {
                  event.preventDefault()
                  void window.igris.system.openExternal(catalog.docsUrl)
                }}
              >
                <ExternalLink size={12} />
                Provider API documentation
              </a>
            </Card>
          ) : (
            <Card className="provider-guide">
              <div className="provider-guide-icon"><Cpu size={20} /></div>
              <span className="eyebrow">Bring your own model</span>
              <h2>A direct line to intelligence.</h2>
              <p>
                IGRIS calls the provider you choose, with your key, from its privileged main
                process. Responses stream into the interface; keys never do.
              </p>
              <ol className="provider-guide-steps">
                <li>
                  <span>01</span>
                  <div>
                    <strong>Choose a provider</strong>
                    <p>OpenAI, Anthropic, Gemini, or any compatible HTTPS endpoint.</p>
                  </div>
                </li>
                <li>
                  <span>02</span>
                  <div>
                    <strong>Add a key and model</strong>
                    <p>Test the connection before using it for a conversation.</p>
                  </div>
                </li>
                <li>
                  <span>03</span>
                  <div>
                    <strong>Mark it default</strong>
                    <p>New conversations route to the default provider automatically.</p>
                  </div>
                </li>
              </ol>
              <div className="provider-guide-note">
                <Lock size={13} />
                No local models. No invented connectivity. If a provider fails, IGRIS says so.
              </div>
              <Button variant="primary" icon={<Plus size={14} />} onClick={() => startCreate()}>
                Add your first provider
              </Button>
            </Card>
          )}

          <Alert tone="info" title="About API usage">
            Cloud providers bill your account directly for tokens. IGRIS never proxies requests
            through its own service and stores no usage metadata beyond your local history.
          </Alert>
        </aside>
      </div>

      <ConfirmDialog
        open={Boolean(removing)}
        title="Remove this provider?"
        description={
          <>
            <strong>{removing?.name}</strong> and its stored key will be deleted. Existing
            conversations keep their local history, but new requests will need another provider.
          </>
        }
        confirmLabel="Remove provider"
        busy={busy}
        onCancel={() => setRemoving(null)}
        onConfirm={() => void removeProvider()}
      />

      <ConfirmDialog
        open={Boolean(clearing)}
        title="Remove the stored API key?"
        description={
          <>
            <strong>{clearing?.name}</strong> will remain configured but cannot make requests
            until you enter a new key. This cannot be undone.
          </>
        }
        confirmLabel="Remove key"
        busy={busy}
        onCancel={() => setClearing(null)}
        onConfirm={() => void clearStoredKey()}
      />
    </div>
  )
}
