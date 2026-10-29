import { BrowserWindow, WebContentsView, session, shell } from 'electron'
import type { BrowserPageText, BrowserState } from '@shared/types'
import { AppError } from '../security/errors'
import { redactAndTruncate } from '../security/redaction'
import type { Logger } from '../services/logger'
import { mainPageUrl, preloadPath } from '../windows/paths'

export interface BrowserShellBounds {
  x: number
  y: number
  width: number
  height: number
}

export class BrowserService {
  private win: BrowserWindow | null = null
  private view: WebContentsView | null = null
  private loading = false
  private pendingUrl: string | null = null
  private lastBounds: BrowserShellBounds = { x: 0, y: 72, width: 1200, height: 700 }

  constructor(
    private readonly logger: Logger,
    private readonly onWindowCreated: (win: BrowserWindow) => void,
    private readonly onStateChanged: (state: BrowserState) => void
  ) {}

  private assertHttpUrl(value: string): string {
    let url: URL
    try {
      url = new URL(value)
    } catch {
      throw new AppError('VALIDATION', 'Enter a valid web address.')
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new AppError('BROWSER', 'IGRIS Browser only opens HTTP and HTTPS pages.')
    }
    if (url.username || url.password) {
      throw new AppError('BROWSER', 'Credentials embedded in URLs are not allowed.')
    }
    return url.toString()
  }

  private normalizeInput(value: string): string {
    const trimmed = value.trim()
    if (!trimmed) return 'https://duckduckgo.com/'
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return this.assertHttpUrl(trimmed)
    if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(trimmed)) return this.assertHttpUrl(`https://${trimmed}`)
    return `https://duckduckgo.com/?q=${encodeURIComponent(trimmed)}`
  }

  getWindow(): BrowserWindow | null {
    return this.win
  }

  state(): BrowserState {
    const wc = this.view?.webContents
    return {
      open: Boolean(this.win && !this.win.isDestroyed()),
      visible: Boolean(
        this.win && !this.win.isDestroyed() && this.win.isVisible() && !this.win.isMinimized()
      ),
      url: wc && !wc.isDestroyed() ? wc.getURL() : '',
      title: wc && !wc.isDestroyed() ? wc.getTitle() : '',
      loading: this.loading,
      canGoBack: wc && !wc.isDestroyed() ? wc.navigationHistory.canGoBack() : false,
      canGoForward: wc && !wc.isDestroyed() ? wc.navigationHistory.canGoForward() : false
    }
  }

  private emit(): void {
    this.onStateChanged(this.state())
  }

  private ensureWindow(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win

    const win = new BrowserWindow({
      width: 1280,
      height: 820,
      minWidth: 820,
      minHeight: 560,
      show: false,
      backgroundColor: '#07080b',
      title: 'IGRIS Browser',
      frame: false,
      autoHideMenuBar: true,
      webPreferences: {
        preload: preloadPath(),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: false,
        spellcheck: false
      }
    })
    this.win = win
    this.onWindowCreated(win)
    win.setMenu(null)

    const browserSession = session.fromPartition('persist:igris-browser')
    browserSession.setPermissionRequestHandler((_wc, permission, callback) => {
      this.logger.warn('browser', `Denied a page permission request: ${permission}.`)
      callback(false)
    })
    browserSession.on('will-download', (event) => {
      event.preventDefault()
      this.logger.warn('browser', 'Blocked a download started by a web page.')
    })

    const view = new WebContentsView({
      webPreferences: {
        session: browserSession,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        spellcheck: false
      }
    })
    this.view = view
    view.setBackgroundColor('#0a0b0e')
    win.contentView.addChildView(view)
    view.setBounds(this.lastBounds)

    const contents = view.webContents
    contents.setWindowOpenHandler(({ url }) => {
      try {
        const safe = this.assertHttpUrl(url)
        setTimeout(() => {
          if (this.view && !this.view.webContents.isDestroyed()) void this.view.webContents.loadURL(safe)
        }, 0)
      } catch {
        this.logger.warn('browser', 'Blocked an unsupported popup URL.')
      }
      return { action: 'deny' }
    })

    contents.on('will-navigate', (event, url) => {
      if (!/^https?:\/\//i.test(url)) {
        event.preventDefault()
        this.logger.warn('browser', 'Blocked navigation to a non-HTTP page.')
      }
    })

    const updateLoading = (value: boolean): void => {
      this.loading = value
      this.emit()
    }
    contents.on('did-start-loading', () => updateLoading(true))
    contents.on('did-stop-loading', () => updateLoading(false))
    contents.on('did-navigate', () => this.emit())
    contents.on('did-navigate-in-page', () => this.emit())
    contents.on('page-title-updated', () => this.emit())
    contents.on('render-process-gone', (_event, details) => {
      this.logger.error('browser', `Browser renderer exited: ${details.reason}.`)
      this.loading = false
      this.emit()
    })

    win.on('show', () => this.emit())
    win.on('hide', () => this.emit())
    win.on('minimize', () => this.emit())
    win.on('restore', () => this.emit())
    win.on('closed', () => {
      this.win = null
      this.view = null
      this.loading = false
      this.pendingUrl = null
      this.emit()
    })

    win.once('ready-to-show', () => {
      win.show()
      win.focus()
    })
    void win.loadURL(mainPageUrl('/browser'))
    void this.view.webContents.loadURL('https://duckduckgo.com/').catch(() => {
      // A caller may navigate before this initial page finishes loading.
    })
    this.logger.info('browser', 'Opened the IGRIS browser window.')
    return win
  }

  private waitForLoad(timeoutMs = 15000): Promise<void> {
    const contents = this.view?.webContents
    if (!contents || contents.isDestroyed()) return Promise.resolve()
    if (!contents.isLoading()) return Promise.resolve()
    return new Promise((resolve) => {
      const finish = (): void => {
        clearTimeout(timer)
        contents.removeListener('did-stop-loading', finish)
        resolve()
      }
      const timer = setTimeout(finish, timeoutMs)
      contents.once('did-stop-loading', finish)
    })
  }

  async open(value: string): Promise<BrowserState> {
    const url = this.normalizeInput(value)
    this.ensureWindow()
    if (!this.view) throw new AppError('BROWSER', 'The browser view is unavailable.')
    this.pendingUrl = url
    try {
      await this.view.webContents.loadURL(url)
      this.pendingUrl = null
    } catch (error) {
      this.pendingUrl = null
      this.loading = false
      this.emit()
      throw new AppError(
        'BROWSER',
        'The page could not be loaded. Check the address and your connection.',
        { cause: error }
      )
    }
    this.emit()
    return this.state()
  }

  show(): BrowserState {
    const win = this.ensureWindow()
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    this.emit()
    return this.state()
  }

  close(): void {
    if (this.win && !this.win.isDestroyed()) this.win.close()
  }

  shellReady(): BrowserState {
    this.ensureWindow()
    if (this.win) this.win.show()
    return this.state()
  }

  shellSetBounds(bounds: BrowserShellBounds): void {
    if (!this.view || !this.win) return
    const contentBounds = this.win.getContentBounds()
    const x = Math.max(0, Math.floor(bounds.x))
    const y = Math.max(0, Math.floor(bounds.y))
    const width = Math.max(0, Math.min(Math.floor(bounds.width), contentBounds.width - x))
    const height = Math.max(0, Math.min(Math.floor(bounds.height), contentBounds.height - y))
    this.lastBounds = { x, y, width, height }
    this.view.setBounds(this.lastBounds)
  }

  async shellGo(value: string): Promise<BrowserState> {
    return this.open(value)
  }

  navigate(action: 'back' | 'forward' | 'reload' | 'stop'): BrowserState {
    const contents = this.view?.webContents
    if (!contents || contents.isDestroyed()) {
      throw new AppError('BROWSER', 'Open IGRIS Browser first.')
    }
    if (action === 'back' && contents.navigationHistory.canGoBack()) {
      contents.navigationHistory.goBack()
    } else if (action === 'forward' && contents.navigationHistory.canGoForward()) {
      contents.navigationHistory.goForward()
    } else if (action === 'reload') {
      contents.reload()
    } else if (action === 'stop') {
      contents.stop()
    }
    this.emit()
    return this.state()
  }

  private requireView(): WebContentsView {
    if (!this.view || !this.win || this.win.isDestroyed()) {
      throw new AppError('BROWSER', 'Open IGRIS Browser before using page tools.')
    }
    return this.view
  }

  async readPage(): Promise<BrowserPageText> {
    const view = this.requireView()
    await this.waitForLoad()
    try {
      const result = (await view.webContents.executeJavaScript(
        `(() => {
          const main = document.querySelector('main, article, [role="main"]') || document.body;
          const text = (main && main.innerText || '').replace(/\\n{3,}/g, '\\n\\n').trim();
          return { url: location.href, title: document.title, text };
        })()`,
        true
      )) as { url?: string; title?: string; text?: string }
      const text = redactAndTruncate(result.text ?? '', 30_000)
      return {
        url: typeof result.url === 'string' ? result.url : '',
        title: typeof result.title === 'string' ? result.title : '',
        text,
        truncated: (result.text ?? '').length > 30_000
      }
    } catch (error) {
      throw new AppError('BROWSER', 'IGRIS could not read the visible page content.', {
        cause: error
      })
    }
  }

  async click(selector: string): Promise<string> {
    const view = this.requireView()
    const clean = selector.trim()
    if (!clean || clean.length > 500) throw new AppError('VALIDATION', 'Enter a valid CSS selector.')
    await this.waitForLoad()
    try {
      const result = (await view.webContents.executeJavaScript(
        `(() => {
          const selector = ${JSON.stringify(clean)};
          let el;
          try { el = document.querySelector(selector); } catch (e) { return { ok: false, error: 'Invalid CSS selector.' }; }
          if (!el) return { ok: false, error: 'No matching element was found.' };
          el.scrollIntoView({ block: 'center', inline: 'center' });
          el.click();
          const label = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || el.tagName || '').trim().slice(0, 120);
          return { ok: true, label };
        })()`,
        true
      )) as { ok?: boolean; error?: string; label?: string }
      if (!result.ok) throw new AppError('BROWSER', result.error ?? 'The element could not be clicked.')
      this.emit()
      return `Clicked ${result.label ? `"${result.label}"` : 'the element'}.`
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError('BROWSER', 'IGRIS could not click that element.', { cause: error })
    }
  }

  async fill(selector: string, text: string): Promise<string> {
    const view = this.requireView()
    const clean = selector.trim()
    if (!clean || clean.length > 500) throw new AppError('VALIDATION', 'Enter a valid CSS selector.')
    if (typeof text !== 'string' || text.length > 5000) {
      throw new AppError('VALIDATION', 'Form text is limited to 5000 characters.')
    }
    await this.waitForLoad()
    try {
      const result = (await view.webContents.executeJavaScript(
        `(() => {
          const selector = ${JSON.stringify(clean)};
          const value = ${JSON.stringify(text)};
          let el;
          try { el = document.querySelector(selector); } catch (e) { return { ok: false, error: 'Invalid CSS selector.' }; }
          if (!el) return { ok: false, error: 'No matching field was found.' };
          if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el.isContentEditable)) {
            return { ok: false, error: 'That element is not a text field.' };
          }
          el.focus();
          if (el.isContentEditable) {
            el.textContent = value;
          } else {
            const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
            if (setter) setter.call(el, value); else el.value = value;
          }
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return { ok: true };
        })()`,
        true
      )) as { ok?: boolean; error?: string }
      if (!result.ok) throw new AppError('BROWSER', result.error ?? 'The field could not be filled.')
      this.emit()
      return `Filled "${clean}". The form has not been submitted.`
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError('BROWSER', 'IGRIS could not fill that field.', { cause: error })
    }
  }

  async youtubeControl(action: 'play' | 'pause' | 'play_pause' | 'next' | 'previous' | 'mute'): Promise<string> {
    const view = this.requireView()
    await this.waitForLoad()
    const host = (() => {
      try {
        return new URL(view.webContents.getURL()).hostname.replace(/^www\./, '')
      } catch {
        return ''
      }
    })()
    if (!host.endsWith('youtube.com')) {
      throw new AppError('BROWSER', 'Open a YouTube page before using playback controls.')
    }
    try {
      const result = (await view.webContents.executeJavaScript(
        `(() => {
          const action = ${JSON.stringify(action)};
          const video = document.querySelector('video');
          if (action === 'next' || action === 'previous') {
            const button = document.querySelector(action === 'next' ? '.ytp-next-button' : '.ytp-prev-button');
            if (!button) return { ok: false, error: 'Playback controls are not visible on this page.' };
            button.click();
            return { ok: true, text: action === 'next' ? 'Skipped to the next video.' : 'Went to the previous video.' };
          }
          if (!video) return { ok: false, error: 'No video element is visible on this page.' };
          if (action === 'play') { video.play(); return { ok: true, text: 'Playing.' }; }
          if (action === 'pause') { video.pause(); return { ok: true, text: 'Paused.' }; }
          if (action === 'play_pause') { if (video.paused) video.play(); else video.pause(); return { ok: true, text: video.paused ? 'Paused.' : 'Playing.' }; }
          if (action === 'mute') { video.muted = !video.muted; return { ok: true, text: video.muted ? 'Muted.' : 'Unmuted.' }; }
          return { ok: false, error: 'Unsupported action.' };
        })()`,
        true
      )) as { ok?: boolean; error?: string; text?: string }
      if (!result.ok) throw new AppError('BROWSER', result.error ?? 'The playback action failed.')
      this.emit()
      return result.text ?? 'Playback action applied.'
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError('BROWSER', 'IGRIS could not control YouTube playback.', { cause: error })
    }
  }

  async search(query: string): Promise<BrowserState> {
    const clean = query.trim()
    if (!clean) throw new AppError('VALIDATION', 'Enter a search query.')
    return this.open(`https://duckduckgo.com/?q=${encodeURIComponent(clean.slice(0, 300))}`)
  }

  async searchYoutube(query: string): Promise<BrowserState> {
    const clean = query.trim()
    if (!clean) throw new AppError('VALIDATION', 'Enter a YouTube search query.')
    return this.open(`https://www.youtube.com/results?search_query=${encodeURIComponent(clean.slice(0, 300))}`)
  }

  async openExternalPage(url: string): Promise<void> {
    const safe = this.assertHttpUrl(url)
    await shell.openExternal(safe)
  }

  dispose(): void {
    if (this.win && !this.win.isDestroyed()) this.win.destroy()
    this.win = null
    this.view = null
  }
}
