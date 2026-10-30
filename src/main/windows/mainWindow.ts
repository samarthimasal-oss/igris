import { app, BrowserWindow, shell } from 'electron'
import type { NavigateEvent, WindowRole } from '@shared/ipc'
import { IPC_NAVIGATE_EVENT } from '@shared/ipc'
import type { SettingsService } from '../services/settingsService'
import type { Logger } from '../services/logger'
import { mainPageUrl, preloadPath } from './paths'

export class MainWindowManager {
  private win: BrowserWindow | null = null
  private quitting = false
  private pendingNavigation: NavigateEvent | null = null
  private rendererReady = false
  private minimizeListener: ((minimized: boolean) => void) | null = null

  constructor(
    private readonly roles: Map<number, WindowRole>,
    private readonly settings: SettingsService,
    private readonly logger: Logger
  ) {}

  setQuitting(value: boolean): void {
    this.quitting = value
  }

  isQuitting(): boolean {
    return this.quitting
  }

  setMinimizeListener(listener: (minimized: boolean) => void): void {
    this.minimizeListener = listener
  }

  getWindow(): BrowserWindow | null {
    return this.win && !this.win.isDestroyed() ? this.win : null
  }

  create(): BrowserWindow {
    const existing = this.getWindow()
    if (existing) return existing

    const win = new BrowserWindow({
      width: 1440,
      height: 920,
      minWidth: 1080,
      minHeight: 700,
      show: false,
      frame: false,
      backgroundColor: '#07080b',
      title: 'IGRIS',
      autoHideMenuBar: true,
      webPreferences: {
        preload: preloadPath(),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        spellcheck: false,
        devTools: !process.env.IGRIS_E2E
      }
    })
    this.win = win
    const webContentsId = win.webContents.id
    this.roles.set(webContentsId, 'main')
    win.setMenu(null)

    win.once('ready-to-show', () => {
      win.show()
      win.focus()
    })

    win.on('minimize', () => this.minimizeListener?.(true))
    win.on('restore', () => this.minimizeListener?.(false))
    win.on('show', () => this.minimizeListener?.(false))
    win.on('hide', () => this.minimizeListener?.(false))

    win.webContents.on('did-start-loading', () => {
      this.rendererReady = false
    })

    win.webContents.on('render-process-gone', (_event, details) => {
      this.logger.error('window', `Main renderer exited unexpectedly: ${details.reason}.`)
      if (!this.quitting && !win.isDestroyed()) {
        win.reload()
      }
    })

    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
    win.webContents.on('will-navigate', (event) => {
      event.preventDefault()
    })

    win.on('close', (event) => {
      if (this.quitting) return
      const closeToTray = this.settings.get().desktop.closeToTray
      if (closeToTray) {
        event.preventDefault()
        win.hide()
        this.logger.info('window', 'Main window hidden to tray.')
        return
      }
      this.quitting = true
      this.logger.info('window', 'Main window closing; quitting IGRIS.')
      app.quit()
    })

    win.on('closed', () => {
      this.roles.delete(webContentsId)
      this.win = null
      this.rendererReady = false
    })

    void win.loadURL(mainPageUrl('/'))
    return win
  }

  show(route = '/', draft?: string): BrowserWindow {
    const win = this.create()
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    if (win.webContents.isLoading() || !this.rendererReady) {
      this.pendingNavigation = { route, draft }
    } else {
      this.sendNavigation(route, draft)
    }
    return win
  }

  markReady(): void {
    this.rendererReady = true
    if (this.pendingNavigation) {
      const navigation = this.pendingNavigation
      this.pendingNavigation = null
      this.sendNavigation(navigation.route, navigation.draft)
    }
  }

  focus(): void {
    const win = this.getWindow()
    if (!win) {
      this.show()
      return
    }
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }

  sendNavigation(route: string, draft?: string): void {
    const win = this.getWindow()
    if (!win || !this.rendererReady) {
      this.pendingNavigation = { route, draft }
      return
    }
    const payload: NavigateEvent = { route, draft }
    win.webContents.send(IPC_NAVIGATE_EVENT, payload)
  }

  send(channel: string, payload: unknown): void {
    const win = this.getWindow()
    if (!win) return
    try {
      win.webContents.send(channel, payload)
    } catch {
      // Window may be closing.
    }
  }

  toggleMaximize(): boolean {
    const win = this.getWindow()
    if (!win) return false
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return win.isMaximized()
  }

  minimize(): void {
    this.getWindow()?.minimize()
  }

  hide(): void {
    this.getWindow()?.hide()
  }

  isMaximized(): boolean {
    return this.getWindow()?.isMaximized() ?? false
  }
}
