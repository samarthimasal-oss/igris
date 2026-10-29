import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Globe2,
  Home,
  Loader2,
  Minimize2,
  RotateCw,
  Search,
  ShieldCheck,
  Square,
  X,
  Youtube
} from 'lucide-react'
import type { BrowserState } from '@shared/types'
import { errorMessage } from '../lib/errors'
import clsx from 'clsx'

const HOME_URL = 'https://duckduckgo.com/'

export function BrowserShell() {
  const [browser, setBrowser] = useState<BrowserState | null>(null)
  const [address, setAddress] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [maximized, setMaximized] = useState(false)
  const viewportRef = useRef<HTMLDivElement>(null)
  const addressRef = useRef<HTMLInputElement>(null)
  const addressFocusedRef = useRef(false)
  const lastBounds = useRef({ x: 0, y: 0, width: 0, height: 0 })

  useLayoutEffect(() => {
    const bridge = window.igris
    const unsubscribe = bridge.browser.onEvent((event) => {
      setBrowser(event.state)
      setAddress((current) =>
        addressFocusedRef.current ? current : event.state.url || current
      )
    })
    void (async () => {
      try {
        const state = await bridge.browser.shellReady()
        setBrowser(state)
        setAddress(state.url || HOME_URL)
        setReady(true)
      } catch (failure) {
        setError(errorMessage(failure, 'The browser surface could not start.'))
        setReady(true)
      }
    })()
    return unsubscribe
    // The browser shell owns a single lifetime for this window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const sendBounds = (): void => {
    const element = viewportRef.current
    if (!element) return
    const rect = element.getBoundingClientRect()
    if (rect.width < 4 || rect.height < 4) return
    const next = {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    }
    if (
      lastBounds.current.x === next.x &&
      lastBounds.current.y === next.y &&
      lastBounds.current.width === next.width &&
      lastBounds.current.height === next.height
    ) {
      return
    }
    lastBounds.current = next
    void window.igris.browser.shellBounds(next)
  }

  useLayoutEffect(() => {
    if (!ready) return
    sendBounds()
    const element = viewportRef.current
    if (!element) return
    const observer = new ResizeObserver(() => sendBounds())
    observer.observe(element)
    window.addEventListener('resize', sendBounds)
    const timer = window.setTimeout(sendBounds, 120)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', sendBounds)
      window.clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.ctrlKey && event.key.toLowerCase() === 'l') {
        event.preventDefault()
        addressRef.current?.focus()
        addressRef.current?.select()
      }
      if (event.ctrlKey && event.key.toLowerCase() === 'r') {
        event.preventDefault()
        void navigateAction('reload')
      }
      if (event.altKey && event.key === 'ArrowLeft') {
        event.preventDefault()
        void navigateAction('back')
      }
      if (event.altKey && event.key === 'ArrowRight') {
        event.preventDefault()
        void navigateAction('forward')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browser])

  const navigateAction = async (action: 'back' | 'forward' | 'reload' | 'stop'): Promise<void> => {
    try {
      setError(null)
      const state = await window.igris.browser.navigate(action)
      setBrowser(state)
    } catch (failure) {
      setError(errorMessage(failure))
    }
  }

  const go = async (value?: string): Promise<void> => {
    const target = (value ?? address).trim()
    if (!target) return
    setError(null)
    try {
      const state = await window.igris.browser.shellGo(target)
      setBrowser(state)
      setAddress(state.url || target)
      addressRef.current?.blur()
    } catch (failure) {
      setError(errorMessage(failure, 'The page could not be opened.'))
    }
  }

  const controlWindow = async (action: 'minimize' | 'maximize' | 'close'): Promise<void> => {
    try {
      const result = await window.igris.system.windowControl(action)
      if (action === 'maximize') setMaximized(result.maximized)
    } catch {
      // Window controls are best-effort.
    }
  }

  const title = browser?.title || (browser?.url ? browser.url : 'IGRIS Browser')

  return (
    <div className="browser-shell">
      <header className="browser-titlebar" onDoubleClick={() => void controlWindow('maximize')}>
        <div className="browser-titlebar-left">
          <span className="brand-mark brand-mark-small" aria-hidden>
            <span className="brand-ring" />
            <span className="brand-core" />
          </span>
          <span className="browser-brand">IGRIS</span>
          <span className="browser-brand-divider">/</span>
          <span className="browser-brand-page">BROWSER</span>
          <span className="browser-title" title={title}>
            {title}
          </span>
        </div>
        <div className="browser-titlebar-right">
          <span className="browser-sandbox-chip">
            <ShieldCheck size={12} /> Isolated session
          </span>
          <div className="window-controls">
            <button type="button" className="window-btn" aria-label="Minimize" onClick={() => void controlWindow('minimize')}>
              <Minimize2 size={13} />
            </button>
            <button
              type="button"
              className="window-btn"
              aria-label={maximized ? 'Restore' : 'Maximize'}
              onClick={() => void controlWindow('maximize')}
            >
              <Square size={11} />
            </button>
            <button
              type="button"
              className="window-btn window-close"
              aria-label="Close browser"
              onClick={() => void controlWindow('close')}
            >
              <X size={14} />
            </button>
          </div>
        </div>
      </header>

      <div className="browser-toolbar">
        <div className="browser-nav-buttons">
          <button
            type="button"
            className="browser-nav-btn"
            aria-label="Back"
            onClick={() => void navigateAction('back')}
            disabled={!browser?.canGoBack}
          >
            <ArrowLeft size={15} />
          </button>
          <button
            type="button"
            className="browser-nav-btn"
            aria-label="Forward"
            onClick={() => void navigateAction('forward')}
            disabled={!browser?.canGoForward}
          >
            <ArrowRight size={15} />
          </button>
          <button
            type="button"
            className="browser-nav-btn"
            aria-label={browser?.loading ? 'Stop loading' : 'Reload'}
            onClick={() => void navigateAction(browser?.loading ? 'stop' : 'reload')}
          >
            {browser?.loading ? <X size={14} /> : <RotateCw size={14} />}
          </button>
          <button
            type="button"
            className="browser-nav-btn"
            aria-label="Home"
            onClick={() => void go(HOME_URL)}
          >
            <Home size={14} />
          </button>
        </div>

        <form
          className="browser-address"
          onSubmit={(event) => {
            event.preventDefault()
            void go()
          }}
        >
          <span className="browser-address-icon">
            {browser?.loading ? (
              <Loader2 size={13} className="spin" />
            ) : browser?.url?.startsWith('https://') ? (
              <ShieldCheck size={13} />
            ) : (
              <Globe2 size={13} />
            )}
          </span>
          <input
            ref={addressRef}
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            onFocus={(event) => {
              addressFocusedRef.current = true
              event.target.select()
            }}
            onBlur={() => {
              addressFocusedRef.current = false
              setAddress(browser?.url || address)
            }}
            placeholder="Search or enter an address"
            spellCheck={false}
            aria-label="Address and search"
          />
          <button type="submit" className="browser-go" aria-label="Go">
            <ArrowRight size={14} />
          </button>
          <div className={clsx('browser-load-track', browser?.loading && 'is-loading')}>
            <span />
          </div>
        </form>

        <div className="browser-quick">
          <button
            type="button"
            className="browser-quick-btn"
            onClick={() => void go('https://duckduckgo.com/')}
            title="Search with DuckDuckGo"
          >
            <Search size={14} />
          </button>
          <button
            type="button"
            className="browser-quick-btn"
            onClick={() => void go('https://www.youtube.com/')}
            title="Open YouTube"
          >
            <Youtube size={15} />
          </button>
        </div>
      </div>

      {error ? (
        <div className="browser-error">
          <X size={13} />
          {error}
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss error">
            <X size={12} />
          </button>
        </div>
      ) : null}

      <div className="browser-viewport" ref={viewportRef}>
        {!ready ? (
          <div className="browser-boot">
            <Loader2 size={20} className="spin" />
            Preparing the isolated browser session…
          </div>
        ) : null}
      </div>
    </div>
  )
}
