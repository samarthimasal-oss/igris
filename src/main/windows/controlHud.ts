import { BrowserWindow, screen } from 'electron'
import type { WindowRole } from '@shared/ipc'
import { IPC_CONTROL_EVENT } from '@shared/ipc'
import type { ControlSessionState } from '@shared/types'
import type { Logger } from '../services/logger'
import { hudPageUrl, preloadPath } from './paths'

const HUD_WIDTH = 360
const HUD_HEIGHT = 92
const EDGE_MARGIN = 16
const MINI_CLEARANCE = 124

/**
 * A small always-on-top control bar. It is created only when a session
 * starts, never steals focus when it appears, and hides as soon as the
 * session ends.
 */
export class ControlHudManager {
  private win: BrowserWindow | null = null
  private state: ControlSessionState | null = null
  private quitting = false
  private loaded = false

  constructor(
    private readonly roles: Map<number, WindowRole>,
    private readonly logger: Logger
  ) {}

  setQuitting(value: boolean): void {
    this.quitting = value
  }

  update(state: ControlSessionState | null): void {
    this.state = state
    if (!state) {
      this.send(null)
      this.hide()
      return
    }
    const win = this.ensure()
    if (this.loaded) {
      this.send(state)
      this.reveal()
    } else {
      win.once('ready-to-show', () => {
        if (this.state) {
          this.send(this.state)
          this.reveal()
        }
      })
    }
  }

  isVisible(): boolean {
    return Boolean(this.win && !this.win.isDestroyed() && this.win.isVisible())
  }

  close(): void {
    this.quitting = true
    this.state = null
    if (this.win && !this.win.isDestroyed()) this.win.destroy()
    this.win = null
    this.loaded = false
  }

  private reveal(): void {
    const win = this.win
    if (!win || win.isDestroyed()) return
    if (!win.isVisible()) win.showInactive()
  }

  private hide(): void {
    const win = this.win
    if (!win || win.isDestroyed()) return
    if (win.isVisible()) win.hide()
  }

  private send(state: ControlSessionState | null): void {
    const win = this.win
    if (!win || win.isDestroyed() || !this.loaded) return
    try {
      win.webContents.send(IPC_CONTROL_EVENT, { type: 'changed', state })
    } catch {
      // The HUD may be closing.
    }
  }

  private ensure(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win
    const area = screen.getPrimaryDisplay().workArea
    const x = Math.round(
      Math.max(area.x + 8, area.x + area.width - HUD_WIDTH - EDGE_MARGIN)
    )
    const y = Math.round(
      Math.max(area.y + 8, area.y + area.height - HUD_HEIGHT - EDGE_MARGIN - MINI_CLEARANCE)
    )
    const win = new BrowserWindow({
      width: HUD_WIDTH,
      height: HUD_HEIGHT,
      x,
      y,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      show: false,
      title: 'IGRIS Control',
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
    this.loaded = false
    this.roles.set(win.webContents.id, 'hud')
    win.setMenu(null)
    win.setAlwaysOnTop(true, 'floating')

    win.webContents.on('did-finish-load', () => {
      this.loaded = true
      if (this.state) {
        this.send(this.state)
        this.reveal()
      }
    })

    win.on('close', (event) => {
      if (this.quitting) return
      event.preventDefault()
      this.hide()
    })

    win.on('closed', () => {
      this.roles.delete(win.webContents.id)
      this.win = null
      this.loaded = false
    })

    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (event) => event.preventDefault())
    void win.loadURL(hudPageUrl())
    this.logger.info('control', 'Created the computer-control HUD.')
    return win
  }
}
