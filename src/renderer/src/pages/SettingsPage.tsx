import { useEffect, useRef, useState } from 'react'
import {
  Check,
  Cpu,
  Database,
  Download,
  FolderOpen,
  Info,
  Lock,
  Monitor,
  Palette,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Wand2
} from 'lucide-react'
import { PERMISSION_META } from '@shared/defaults'
import type { DeepPartial, PermissionKey, Settings } from '@shared/types'
import { useAppStore } from '../lib/store'
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Field,
  KeyValue,
  PageHeader,
  SegmentedControl,
  Select,
  Slider,
  Textarea,
  Toggle
} from '../components/ui'
import { errorMessage } from '../lib/errors'
import { formatBytes, fullTime, plural } from '../lib/format'
import clsx from 'clsx'

const PERMISSION_ORDER: PermissionKey[] = [
  'filesystem',
  'fileWrite',
  'projectWrite',
  'terminal',
  'appLaunch',
  'browser',
  'screen',
  'inputControl'
]

const SECTION_LINKS = [
  { id: 'settings-appearance', label: 'Appearance', icon: Palette },
  { id: 'settings-desktop', label: 'Desktop', icon: Monitor },
  { id: 'settings-permissions', label: 'Permissions', icon: ShieldCheck },
  { id: 'settings-ai', label: 'Intelligence', icon: SlidersHorizontal },
  { id: 'settings-privacy', label: 'Privacy & data', icon: Lock },
  { id: 'settings-about', label: 'About', icon: Info }
]

type SaveState = 'idle' | 'saving' | 'saved'

export function SettingsPage() {
  const settings = useAppStore((state) => state.settings)
  const system = useAppStore((state) => state.system)
  const health = useAppStore((state) => state.health)
  const companion = useAppStore((state) => state.companion)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const refreshCompanion = useAppStore((state) => state.refreshCompanion)
  const refreshConversations = useAppStore((state) => state.refreshConversations)
  const newConversation = useAppStore((state) => state.newConversation)
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
  const saveTimer = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
    }
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

  const toggleCompanion = async (): Promise<void> => {
    try {
      if (settings.desktop.companionEnabled) await window.igris.companion.hide()
      else await window.igris.companion.show()
      await refreshCompanion()
    } catch (error) {
      notify('error', 'Companion unavailable', errorMessage(error))
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

  return (
    <div className="page settings-page">
      <PageHeader
        eyebrow="Preferences"
        title="Settings"
        description="Tune the surface, grant capabilities, and decide what remains on this machine."
        actions={
          <div className={clsx('save-indicator', `is-${saveState}`)}>
            {saveState === 'saved' ? <Check size={13} /> : saveState === 'saving' ? <RefreshCw size={13} className="spin" /> : <Lock size={13} />}
            {saveState === 'saved' ? 'Saved locally' : saveState === 'saving' ? 'Saving…' : 'Changes save instantly'}
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
                <Icon size={14} />
                {section.label}
              </button>
            )
          })}
          <div className="settings-nav-foot">
            <Sparkles size={13} />
            <span>IGRIS v{system?.version ?? '1.0.0'}</span>
          </div>
        </nav>

        <div className="settings-sections">
          <Card className="settings-card" id="settings-appearance">
            <div className="settings-card-head">
              <div className="settings-card-icon"><Palette size={17} /></div>
              <div>
                <h2>Appearance</h2>
                <p>Visual identity and rendering quality. Changes apply immediately.</p>
              </div>
            </div>

            <div className="settings-block">
              <div className="settings-label">Accent identity</div>
              <div className="accent-options">
                {(
                  [
                    ['azure', 'Electric azure', '#4da3ff'],
                    ['violet', 'Ultraviolet', '#a78bfa'],
                    ['silver', 'Titanium silver', '#d4deea']
                  ] as const
                ).map(([value, label, color]) => (
                  <button
                    key={value}
                    type="button"
                    className={clsx('accent-option', settings.appearance.accent === value && 'is-active')}
                    onClick={() => void apply({ appearance: { accent: value } })}
                  >
                    <span className="accent-swatch" style={{ backgroundColor: color }} />
                    <span>{label}</span>
                    {settings.appearance.accent === value ? <Check size={13} /> : null}
                  </button>
                ))}
              </div>
            </div>

            <div className="settings-row">
              <div className="settings-row-copy">
                <strong>Render quality</strong>
                <p>Controls the 3D core resolution and particle density.</p>
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
                checked={settings.appearance.show3d}
                onChange={(value) => void apply({ appearance: { show3d: value } })}
                label="Render the 3D core"
                description="Disable for a static CSS core if GPU acceleration is limited."
              />
              <Toggle
                checked={settings.appearance.reducedMotion}
                onChange={(value) => void apply({ appearance: { reducedMotion: value } })}
                label="Reduce motion"
                description="Dampened motion, slower core rotation, and no floating animation."
              />
            </div>
          </Card>

          <Card className="settings-card" id="settings-desktop">
            <div className="settings-card-head">
              <div className="settings-card-icon"><Monitor size={17} /></div>
              <div>
                <h2>Desktop & companion</h2>
                <p>Native window behaviour and the always-on-top presence.</p>
              </div>
              <Badge tone={settings.desktop.companionEnabled ? 'success' : 'neutral'} dot>
                {settings.desktop.companionEnabled ? 'Companion on' : 'Companion off'}
              </Badge>
            </div>

            <div className="settings-toggle-list">
              <Toggle
                checked={settings.desktop.companionEnabled}
                onChange={(value) => void apply({ desktop: { companionEnabled: value } })}
                label="Show the desktop companion"
                description="A movable, transparent robot window that stays above other apps."
              />
              <Toggle
                checked={settings.desktop.companionAlwaysOnTop}
                onChange={(value) => void apply({ desktop: { companionAlwaysOnTop: value } })}
                label="Keep the companion above other windows"
                description="Can be changed at any time from the companion itself."
              />
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
                description="Keep the local core running when the main window closes."
              />
            </div>

            <div className="settings-inline-actions">
              <Button variant="default" size="sm" onClick={() => void toggleCompanion()}>
                {settings.desktop.companionEnabled ? 'Hide companion' : 'Show companion'}
              </Button>
              <span className="settings-inline-note">
                {companion?.open ? `Companion window ${companion.status}` : 'Companion is not open'}
              </span>
            </div>
          </Card>

          <Card className="settings-card" id="settings-permissions">
            <div className="settings-card-head">
              <div className="settings-card-icon"><ShieldCheck size={17} /></div>
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
              fixed. These safeguards reduce risk but do not replace your review.
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
                        {meta.sensitive ? <span className="permission-sensitive">Sensitive</span> : null}
                      </span>
                    }
                    description={meta.description}
                    tone={meta.sensitive ? 'danger' : 'default'}
                  />
                )
              })}
            </div>
          </Card>

          <Card className="settings-card" id="settings-ai">
            <div className="settings-card-head">
              <div className="settings-card-icon"><Cpu size={17} /></div>
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
                description="Strongly recommended. High-risk tools always require explicit approval in the interface."
                tone="danger"
              />
            </div>

            <Field
              label="System instructions"
              hint="Included in every conversation. Do not paste secrets. Changes are saved on demand."
            >
              <Textarea
                value={instructions}
                onChange={(event) => {
                  setInstructions(event.target.value)
                  setInstructionsDirty(event.target.value.trim() !== settings.ai.systemInstructions)
                }}
                rows={5}
                placeholder="Optional guidance for tone, working style, or standing preferences."
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

          <Card className="settings-card" id="settings-privacy">
            <div className="settings-card-head">
              <div className="settings-card-icon"><Lock size={17} /></div>
              <div>
                <h2>Privacy & data</h2>
                <p>You decide what is retained. Nothing leaves this machine unless a provider call requires it.</p>
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

            <Field
              label="Conversation retention"
              hint="A value of zero keeps history until you clear it manually."
            >
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
              <Button variant="default" size="sm" icon={<Download size={14} />} onClick={() => void exportData()}>
                Export local data
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon={<Database size={14} />}
                onClick={() => void revealData(system?.userDataPath ?? '')}
                disabled={!system}
              >
                Open data folder
              </Button>
              <Button
                variant="danger"
                size="sm"
                icon={<Trash2 size={14} />}
                onClick={() => setClearOpen(true)}
              >
                Clear history
              </Button>
            </div>
            <p className="settings-fineprint">
              Exports include conversations, memories, tasks, and settings — never API keys.
            </p>
          </Card>

          <Card className="settings-card" id="settings-about">
            <div className="settings-card-head">
              <div className="settings-card-icon"><Info size={17} /></div>
              <div>
                <h2>About IGRIS</h2>
                <p>Runtime facts, local paths, and setup.</p>
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
                <KeyValue label="Platform">{system ? `${system.platform} ${system.arch}` : '—'}</KeyValue>
              </div>
              <div className="about-kv">
                <KeyValue label="Started">{system ? fullTime(system.startedAt) : '—'}</KeyValue>
                <KeyValue label="Provider">{health?.activeProvider ?? 'None'}</KeyValue>
                <KeyValue label="Database">{health ? formatBytes(health.databaseBytes) : '—'}</KeyValue>
                <KeyValue label="Companion">{health?.companionOpen ? 'Open' : 'Closed'}</KeyValue>
                <KeyValue label="Browser">{health?.browserOpen ? 'Open' : 'Closed'}</KeyValue>
                <KeyValue label="Mode">{system?.isPackaged ? 'Installed build' : 'Development'}</KeyValue>
              </div>
            </div>

            <Field label="Local data path">
              <div className="path-readout">
                <code>{system?.userDataPath ?? 'Unavailable'}</code>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<FolderOpen size={13} />}
                  onClick={() => void revealData(system?.userDataPath ?? '')}
                >
                  Reveal
                </Button>
              </div>
            </Field>

            <div className="settings-inline-actions">
              <Button variant="default" size="sm" icon={<Wand2 size={14} />} onClick={openOnboarding}>
                Replay setup guide
              </Button>
              <span className="settings-inline-note">
                Resets nothing; opens the four-step orientation again.
              </span>
            </div>

            <div className="about-footer">
              <span>
                <ShieldCheck size={12} /> Cloud-only AI · no local model runtime
              </span>
              <span>
                <Lock size={12} /> Credentials protected by Windows DPAPI
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
              Settings, providers, and stored API keys are not affected. Stop active responses
              before clearing.
            </p>
          </div>
        }
        confirmLabel="Clear selected history"
        busy={clearing}
        onCancel={() => setClearOpen(false)}
        onConfirm={() => void clearHistory()}
      />
    </div>
  )
}
