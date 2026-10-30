import { BrowserWindow, screen } from 'electron'
import type { CompanionState } from '@shared/types'
import type { CompanionEvent, WindowRole } from '@shared/ipc'
import { IPC_COMPANION_EVENT } from '@shared/ipc'
import type { SettingsService } from '../services/settingsService'
import type { Logger } from '../services/logger'
import { companionPageUrl, preloadPath } from './paths'

const COMPANION_WIDTH = 280
const COMPANION_HEIGHT = 340

export class CompanionManager {
  private win: BrowserWindow | null = null
  private status: CompanionState['status'] = 'idle'
  private statusText = 'Ready'
  private quitting = false
  private saveTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly roles: Map<number, WindowRole>,
    private readonly settings: SettingsService,
    private readonly logger: Logger,
    private readonly onState: (event: CompanionEvent) => void
  ) {}

  setQuitting(value: boolean): void {
    this.quitting = value
  }

  private defaultPosition(): { x: number; y: number } {
    const area = screen.getPrimaryDisplay().workArea
    return {
      x: Math.round(area.x + area.width - COMPANION_WIDTH - 28),
      y: Math.round(area.y + area.height - COMPANION_HEIGHT - 28)
    }
  }

  private clampPosition(position: { x: number; y: number }): { x: number; y: number } {
    const display = screen.getDisplayMatching({
      x: Math.round(position.x),
      y: Math.round(position.y),
      width: COMPANION_WIDTH,
      height: COMPANION_HEIGHT
    })
    const area = display.workArea
    return {
      x: Math.round(Math.min(Math.max(position.x, area.x + 8), area.x + area.width - COMPANION_WIDTH - 8)),
      y: Math.round(Math.min(Math.max(position.y, area.y + 8), area.y + area.height - COMPANION_HEIGHT - 8))
    }
  }

  private create(): BrowserWindow {
    const settings = this.settings.get()
    const saved = settings.desktop.companionPosition
    const position = this.clampPosition(saved ?? this.defaultPosition())
    const win = new BrowserWindow({
      width: COMPANION_WIDTH,
      height: COMPANION_HEIGHT,
      x: position.x,
      y: position.y,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: settings.desktop.companionAlwaysOnTop,
      hasShadow: false,
      show: false,
      title: 'IGRIS Companion',
      webPreferences: {
        preload: preloadPath(),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
        devTools: false,
        backgroundThrottling: false
      }
    })
    this.win = win
    this.roles.set(win.webContents.id, 'companion')
    win.setMenu(null)
    win.setAlwaysOnTop(settings.desktop.companionAlwaysOnTop, 'floating')
    try {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    } catch {
      // Not supported by every Windows shell configuration.
    }

    win.once('ready-to-show', () => {
      if (this.settings.get().desktop.companionEnabled) win.showInactive()
      this.emit()
    })

    win.on('moved', () => {
      if (this.saveTimer) clearTimeout(this.saveTimer)
      this.saveTimer = setTimeout(() => {
        if (!this.win || this.win.isDestroyed()) return
        const [x, y] = this.win.getPosition()
        this.settings.update({ desktop: { companionPosition: { x, y } } })
      }, 250)
    })

    win.on('close', (event) => {
      if (!this.quitting) {
        event.preventDefault()
        win.hide()
        this.emit()
      }
    })

    win.on('show', () => this.emit())
    win.on('hide', () => this.emit())
    win.on('closed', () => {
      if (this.win) this.roles.delete(this.win.webContents.id)
      this.win = null
      this.emit()
    })

    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (event) => event.preventDefault())
    void win.loadURL(companionPageUrl())
    this.logger.info('companion', 'Created the desktop companion window.')
    return win
  }

  ensure(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win
    return this.create()
  }

  show(): void {
    const win = this.ensure()
    const settings = this.settings.get()
    if (!settings.desktop.companionEnabled) {
      this.settings.update({ desktop: { companionEnabled: true } })
    }
    win.setAlwaysOnTop(this.settings.get().desktop.companionAlwaysOnTop, 'floating')
    win.showInactive()
    this.emit()
  }

  hide(): void {
    this.win?.hide()
    this.emit()
  }

  applySettings(): void {
    const settings = this.settings.get()
    if (settings.desktop.companionEnabled) {
      const win = this.ensure()
      win.setAlwaysOnTop(settings.desktop.companionAlwaysOnTop, 'floating')
      if (!win.isVisible()) win.showInactive()
    } else if (this.win && !this.win.isDestroyed()) {
      this.win.hide()
    }
    this.emit()
  }

  applyAlwaysOnTop(): void {
    if (this.win && !this.win.isDestroyed()) {
      this.win.setAlwaysOnTop(this.settings.get().desktop.companionAlwaysOnTop, 'floating')
    }
    this.emit()
  }

  setAlwaysOnTop(value: boolean): void {
    this.win?.setAlwaysOnTop(value, 'floating')
    this.settings.update({ desktop: { companionAlwaysOnTop: value } })
    this.emit()
  }

  setStatus(status: CompanionState['status'], text: string): void {
    this.status = status
    this.statusText = text
    this.emit()
  }

  state(): CompanionState {
    const settings = this.settings.get()
    return {
      open: Boolean(this.win && !this.win.isDestroyed()),
      enabled: settings.desktop.companionEnabled,
      alwaysOnTop: settings.desktop.companionAlwaysOnTop,
      status: this.status,
      statusText: this.statusText
    }
  }

  private emit(): void {
    this.onState({ state: this.state() })
    if (this.win && !this.win.isDestroyed()) {
      try {
        this.win.webContents.send(IPC_COMPANION_EVENT, { state: this.state() } satisfies CompanionEvent)
      } catch {
        // Window is closing.
      }
    }
  }

  close(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    if (this.win && !this.win.isDestroyed()) {
      this.quitting = true
      this.win.destroy()
    }
    this.win = null
  }

  focusMainWindow(): void {
    const main = BrowserWindow.getAllWindows().find((candidate) => {
      return this.roles.get(candidate.webContents.id) === 'main'
    })
    if (main) {
      if (main.isMinimized()) main.restore()
      main.show()
      main.focus()
    }
  }

  isOpen(): boolean {
    return Boolean(this.win && !this.win.isDestroyed())
  }

  getBounds(): { x: number; y: number; width: number; height: number } | null {
    if (!this.win || this.win.isDestroyed() || !this.win.isVisible()) return null
    const [x, y] = this.win.getPosition()
    const [width, height] = this.win.getSize()
    return { x, y, width, height }
  }
}
