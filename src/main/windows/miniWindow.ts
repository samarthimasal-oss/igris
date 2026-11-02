import { BrowserWindow, screen } from 'electron'
import type { WindowRole } from '@shared/ipc'
import type { Logger } from '../services/logger'
import { miniPageUrl, preloadPath } from './paths'

const MINI_SIZE = 112
const EDGE_MARGIN = 18

export class MiniLauncherManager {
  private win: BrowserWindow | null = null
  private quitting = false
  private wantsVisible = false
  private position: { x: number; y: number } | null = null

  constructor(
    private readonly roles: Map<number, WindowRole>,
    private readonly logger: Logger
  ) {}

  setQuitting(value: boolean): void {
    this.quitting = value
  }

  private defaultPosition(): { x: number; y: number } {
    const area = screen.getPrimaryDisplay().workArea
    const x = area.x + area.width - MINI_SIZE - EDGE_MARGIN
    const y = area.y + area.height - MINI_SIZE - EDGE_MARGIN
    return { x: Math.round(x), y: Math.round(y) }
  }

  private clampPosition(position: { x: number; y: number }): { x: number; y: number } {
    const display = screen.getDisplayMatching({
      x: Math.round(position.x),
      y: Math.round(position.y),
      width: MINI_SIZE,
      height: MINI_SIZE
    })
    const area = display.workArea
    return {
      x: Math.round(
        Math.min(Math.max(position.x, area.x + 8), area.x + area.width - MINI_SIZE - 8)
      ),
      y: Math.round(
        Math.min(Math.max(position.y, area.y + 8), area.y + area.height - MINI_SIZE - 8)
      )
    }
  }

  private create(): BrowserWindow {
    const position = this.clampPosition(this.position ?? this.defaultPosition())
    const win = new BrowserWindow({
      width: MINI_SIZE,
      height: MINI_SIZE,
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
      alwaysOnTop: true,
      hasShadow: false,
      show: false,
      title: 'IGRIS',
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
    this.roles.set(win.webContents.id, 'mini')
    win.setMenu(null)
    win.setAlwaysOnTop(true, 'floating')

    win.once('ready-to-show', () => {
      if (this.wantsVisible) win.showInactive()
    })

    win.on('moved', () => {
      if (!this.win || this.win.isDestroyed()) return
      const [x, y] = this.win.getPosition()
      this.position = { x, y }
    })

    win.on('close', (event) => {
      if (this.quitting) return
      event.preventDefault()
      this.wantsVisible = false
      win.hide()
    })

    win.on('closed', () => {
      this.roles.delete(win.webContents.id)
      this.win = null
    })

    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (event) => event.preventDefault())
    void win.loadURL(miniPageUrl())
    this.logger.info('mini', 'Created the minimized-IGRIS launcher.')
    return win
  }

  private ensure(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win
    return this.create()
  }

  show(): void {
    this.wantsVisible = true
    const win = this.ensure()
    const position = this.clampPosition(this.position ?? this.defaultPosition())
    win.setPosition(position.x, position.y, false)
    if (win.isVisible() || win.webContents.isLoading()) return
    win.showInactive()
  }

  hide(): void {
    this.wantsVisible = false
    if (this.win && !this.win.isDestroyed() && this.win.isVisible()) this.win.hide()
  }

  isVisible(): boolean {
    return Boolean(this.win && !this.win.isDestroyed() && this.win.isVisible())
  }

  close(): void {
    this.quitting = true
    this.wantsVisible = false
    if (this.win && !this.win.isDestroyed()) this.win.destroy()
    this.win = null
  }
}
