import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AppWindow,
  ArrowRight,
  Calculator,
  Camera,
  Code2,
  FileText,
  FolderOpen,
  Globe2,
  Monitor,
  Paintbrush,
  Play,
  RefreshCw,
  Settings,
  ShieldCheck,
  SquareTerminal
} from 'lucide-react'
import type {
  AppInfo,
  ScreenCapture,
  ScreenStatus,
  WindowInfo
} from '@shared/types'
import { PERMISSION_META } from '@shared/defaults'
import { useAppStore } from '../lib/store'
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Spinner,
  Tabs
} from '../components/ui'
import { errorHint, errorMessage } from '../lib/errors'
import { fullTime, plural } from '../lib/format'
import clsx from 'clsx'

type ComputerTab = 'overview' | 'apps' | 'windows'

const APP_ICONS: Record<string, typeof FileText> = {
  notepad: FileText,
  calculator: Calculator,
  explorer: FolderOpen,
  paint: Paintbrush,
  terminal: SquareTerminal,
  vscode: Code2,
  settings: Settings
}

export function ComputerPage() {
  const navigate = useNavigate()
  const settings = useAppStore((state) => state.settings)
  const notify = useAppStore((state) => state.notify)
  const [tab, setTab] = useState<ComputerTab>('overview')
  const [screenStatus, setScreenStatus] = useState<ScreenStatus | null>(null)
  const [capture, setCapture] = useState<ScreenCapture | null>(null)
  const [capturing, setCapturing] = useState(false)
  const [apps, setApps] = useState<AppInfo[]>([])
  const [appsLoading, setAppsLoading] = useState(false)
  const [launching, setLaunching] = useState<string | null>(null)
  const [windows, setWindows] = useState<WindowInfo[]>([])
  const [windowsLoading, setWindowsLoading] = useState(false)
  const [windowsError, setWindowsError] = useState<string | null>(null)

  const canScreen = settings?.permissions.screen ?? false
  const canLaunch = settings?.permissions.appLaunch ?? false
  const canBrowser = settings?.permissions.browser ?? false

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const status = await window.igris.computer.screenStatus()
        if (active) setScreenStatus(status)
      } catch (error) {
        if (active) setScreenStatus({ supported: false, detail: errorMessage(error) })
      }
      setAppsLoading(true)
      try {
        const list = await window.igris.computer.apps()
        if (active) setApps(list)
      } catch (error) {
        if (active) notify('error', 'Could not list applications', errorMessage(error))
      } finally {
        if (active) setAppsLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [notify])

  const loadWindows = async (): Promise<void> => {
    if (!canScreen) {
      setWindowsError('Screen access is required to read the Windows process list.')
      return
    }
    setWindowsLoading(true)
    setWindowsError(null)
    try {
      setWindows(await window.igris.computer.windows())
    } catch (error) {
      setWindowsError(`${errorMessage(error)} ${errorHint(error) ?? ''}`.trim())
    } finally {
      setWindowsLoading(false)
    }
  }

  useEffect(() => {
    if (tab === 'windows' && canScreen && !windows.length && !windowsLoading) {
      void loadWindows()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, canScreen])

  const captureScreen = async (): Promise<void> => {
    if (!canScreen) {
      notify('warning', 'Screen access is disabled', 'Enable it in Settings → Permissions.')
      return
    }
    setCapturing(true)
    try {
      const result = await window.igris.computer.capture()
      setCapture(result)
      notify('success', 'Screen captured', `${result.width} × ${result.height} · stored locally`)
    } catch (error) {
      notify('error', 'Screen capture failed', `${errorMessage(error)} ${errorHint(error) ?? ''}`.trim())
    } finally {
      setCapturing(false)
    }
  }

  const launchApp = async (app: AppInfo): Promise<void> => {
    if (!canLaunch) {
      notify('warning', 'App launch is disabled', 'Enable it in Settings → Permissions.')
      return
    }
    setLaunching(app.id)
    try {
      const result = await window.igris.computer.launchApp(app.id)
      notify('success', `${app.name} launched`, result.message)
    } catch (error) {
      notify('error', `Could not launch ${app.name}`, `${errorMessage(error)} ${errorHint(error) ?? ''}`.trim())
    } finally {
      setLaunching(null)
    }
  }

  const openBrowser = async (): Promise<void> => {
    try {
      await window.igris.system.openExternal('https://www.youtube.com/')
      notify('info', 'Default browser opened', 'IGRIS hands web pages to Chrome, Edge, or whatever Windows uses.')
    } catch (error) {
      notify('error', 'Could not open your browser', `${errorMessage(error)} ${errorHint(error) ?? ''}`.trim())
    }
  }

  const revealCapture = async (): Promise<void> => {
    if (!capture) return
    try {
      await window.igris.system.revealPath(capture.path)
    } catch (error) {
      notify('error', 'Could not reveal screenshot', errorMessage(error))
    }
  }

  return (
    <div className="page computer-page">
      <PageHeader
        eyebrow="Native capabilities"
        title="Computer"
        description="See your real screen, launch approved apps, and inspect open windows — real vision, permissioned access."
        actions={
          <>
            <Button variant="primary" icon={<Camera size={15} />} onClick={() => void captureScreen()} loading={capturing}>
              See my screen
            </Button>
          </>
        }
      />

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'overview', label: 'Overview' },
          { value: 'apps', label: 'Applications', count: apps.length },
          { value: 'windows', label: 'Windows', count: windows.length }
        ]}
      />

      {tab === 'overview' ? (
        <>
          {!canScreen ? (
            <Alert
              tone="warning"
              title="Screen access is off"
              action={
                <Button size="sm" variant="default" onClick={() => navigate('/settings')}>
                  Enable
                </Button>
              }
            >
              IGRIS cannot look at your screen or read open windows until you grant screen
              access. Captures stay local.
            </Alert>
          ) : null}

          <div className="computer-grid">
            <Card className="capture-card">
              <div className="capture-head">
                <div>
                  <span className="eyebrow">Display surface</span>
                  <h2>See my screen</h2>
                </div>
                <Badge tone={screenStatus?.supported ? 'success' : 'warning'} dot>
                  {screenStatus?.supported ? 'Available' : 'Unavailable'}
                </Badge>
              </div>
              <div className={clsx('capture-stage', capture && 'has-image')}>
                {capture ? (
                  <img src={capture.dataUrl} alt="Screen capture preview" />
                ) : (
                  <div className="capture-placeholder">
                    <span className="capture-crosshair" />
                    <Monitor size={34} strokeWidth={1.2} />
                    <strong>No capture yet</strong>
                    <p>
                      Ask IGRIS to “see my screen” in a conversation, or trigger a capture below.
                      IGRIS stores it in its local data folder.
                    </p>
                  </div>
                )}
              </div>
              <div className="capture-foot">
                <div>
                  <span>{screenStatus?.detail ?? 'Checking display support…'}</span>
                  {capture ? (
                    <small>
                      {capture.width} × {capture.height} · {fullTime(capture.capturedAt)}
                    </small>
                  ) : null}
                </div>
                <div className="capture-actions">
                  {capture ? (
                    <Button variant="ghost" size="sm" onClick={() => void revealCapture()}>
                      Open file
                    </Button>
                  ) : null}
                  <Button
                    variant="default"
                    size="sm"
                    icon={<Camera size={13} />}
                    onClick={() => void captureScreen()}
                    loading={capturing}
                    disabled={!screenStatus?.supported}
                  >
                    {capture ? 'Capture again' : 'Capture'}
                  </Button>
                </div>
              </div>
            </Card>

            <div className="computer-side">
              <Card className="permission-summary">
                <div className="section-heading compact">
                  <div>
                    <h2>Access surface</h2>
                    <p>What this section can do right now.</p>
                  </div>
                  <ShieldCheck size={17} className="muted-icon" />
                </div>
                <div className="permission-list">
                  {(
                    [
                      ['screen', canScreen],
                      ['appLaunch', canLaunch],
                      ['browser', canBrowser]
                    ] as const
                  ).map(([key, enabled]) => (
                    <div key={key} className="permission-row">
                      <span className="permission-label">{PERMISSION_META[key].label}</span>
                      <Badge tone={enabled ? 'success' : 'neutral'} dot>
                        {enabled ? 'Allowed' : 'Off'}
                      </Badge>
                    </div>
                  ))}
                </div>
                <Button variant="ghost" size="sm" onClick={() => navigate('/settings')} trailingIcon={<ArrowRight size={13} />}>
                  Manage permissions
                </Button>
              </Card>

              <Card className="browser-status-card">
                <div className="browser-status-head">
                  <span className="browser-status-icon">
                    <Globe2 size={16} />
                  </span>
                  <div>
                    <strong>Default browser</strong>
                    <p>Web pages open in Chrome, Edge, or whatever Windows uses</p>
                  </div>
                  <Badge tone={canBrowser ? 'success' : 'neutral'} dot>
                    {canBrowser ? 'Allowed' : 'Off'}
                  </Badge>
                </div>
                <div className="browser-status-foot">
                  <span>IGRIS cannot read or control those pages</span>
                  <Button variant="default" size="sm" onClick={() => void openBrowser()}>
                    Open YouTube
                  </Button>
                </div>
              </Card>
            </div>
          </div>

          <div className="computer-details">
            <Card>
              <div className="section-heading compact">
                <div>
                  <h2>Local telemetry</h2>
                  <p>Read from Windows, never uploaded.</p>
                </div>
              </div>
              <div className="detail-grid">
                <div>
                  <span>Displays</span>
                  <strong>{screenStatus?.supported ? 'Detected' : 'Unavailable'}</strong>
                  <small>{screenStatus?.detail ?? '—'}</small>
                </div>
                <div>
                  <span>Default browser</span>
                  <strong>{canBrowser ? 'Handoff allowed' : 'Locked'}</strong>
                  <small>IGRIS never reads those pages</small>
                </div>
                <div>
                  <span>Approved apps</span>
                  <strong>{apps.filter((app) => app.available).length}</strong>
                  <small>Windows allowlist</small>
                </div>
                <div>
                  <span>Voice input</span>
                  <strong>{settings?.permissions.voice ? 'Enabled' : 'Locked'}</strong>
                  <small>Cloud transcription via microphone</small>
                </div>
              </div>
            </Card>
          </div>
        </>
      ) : null}

      {tab === 'apps' ? (
        <Card className="apps-panel">
          <div className="section-heading">
            <div>
              <h2>Approved applications</h2>
              <p>IGRIS can only start applications from this verified list.</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              icon={<RefreshCw size={13} />}
              onClick={() => {
                setAppsLoading(true)
                void window.igris.computer
                  .apps()
                  .then(setApps)
                  .catch((error: unknown) => notify('error', 'Could not refresh apps', errorMessage(error)))
                  .finally(() => setAppsLoading(false))
              }}
              loading={appsLoading}
            >
              Refresh
            </Button>
          </div>
          {!canLaunch ? (
            <Alert
              tone="info"
              title="Launching is disabled"
              action={
                <Button size="sm" variant="default" onClick={() => navigate('/settings')}>
                  Permissions
                </Button>
              }
            >
              Enable “Launch applications” to start any item below.
            </Alert>
          ) : null}
          <div className="app-grid">
            {apps.map((app) => {
              const Icon = APP_ICONS[app.id] ?? AppWindow
              return (
                <div key={app.id} className={clsx('app-card', !app.available && 'is-unavailable')}>
                  <span className="app-icon">
                    <Icon size={20} />
                  </span>
                  <div className="app-copy">
                    <strong>{app.name}</strong>
                    <p>{app.description}</p>
                    <Badge tone={app.available ? 'success' : 'neutral'}>
                      {app.available ? 'Installed' : 'Not found'}
                    </Badge>
                  </div>
                  <Button
                    variant="default"
                    size="sm"
                    icon={<Play size={12} />}
                    onClick={() => void launchApp(app)}
                    loading={launching === app.id}
                    disabled={!app.available || !canLaunch}
                  >
                    Launch
                  </Button>
                </div>
              )
            })}
          </div>
        </Card>
      ) : null}

      {tab === 'windows' ? (
        <Card className="windows-panel">
          <div className="section-heading">
            <div>
              <h2>Open windows</h2>
              <p>A snapshot of visible windows and their processes.</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              icon={<RefreshCw size={13} />}
              onClick={() => void loadWindows()}
              loading={windowsLoading}
              disabled={!canScreen}
            >
              Refresh
            </Button>
          </div>
          {windowsError ? <Alert tone="danger">{windowsError}</Alert> : null}
          {windowsLoading ? (
            <div className="table-loading">
              <Spinner size={16} /> Reading window titles…
            </div>
          ) : windows.length ? (
            <div className="window-table">
              <div className="window-row window-head">
                <span>Window title</span>
                <span>Process</span>
                <span>PID</span>
              </div>
              {windows.map((window) => (
                <div className="window-row" key={`${window.processId}-${window.title}`}>
                  <span className="window-title">{window.title}</span>
                  <span className="mono">{window.process}</span>
                  <span className="mono">{window.processId}</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={AppWindow}
              title={canScreen ? 'No visible windows' : 'Screen access is required'}
              description={
                canScreen
                  ? 'Windows did not report any titled processes.'
                  : 'Grant screen access to let IGRIS read the Windows process list.'
              }
              action={
                canScreen ? (
                  <Button variant="default" size="sm" onClick={() => void loadWindows()}>
                    Refresh list
                  </Button>
                ) : (
                  <Button variant="default" size="sm" onClick={() => navigate('/settings')}>
                    Open permissions
                  </Button>
                )
              }
            />
          )}
          <div className="panel-footnote">
            <span>{plural(windows.length, 'window')} detected</span>
            <span>Process inspection is local and read-only.</span>
          </div>
        </Card>
      ) : null}
    </div>
  )
}
