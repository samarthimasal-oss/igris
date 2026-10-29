import { useEffect, useRef, useState } from 'react'
import {
  ArrowUpRight,
  Minus,
  Pin,
  SendHorizontal,
  Sparkles
} from 'lucide-react'
import type { CompanionState } from '@shared/types'
import clsx from 'clsx'

export function CompanionApp() {
  const [state, setState] = useState<CompanionState | null>(null)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const flashTimer = useRef<number | null>(null)

  useEffect(() => {
    const bridge = window.igris
    const unsubscribe = bridge.companion.onEvent((event) => setState(event.state))
    void bridge.companion
      .state()
      .then(setState)
      .catch(() => setState(null))
    return () => {
      unsubscribe()
      if (flashTimer.current) window.clearTimeout(flashTimer.current)
    }
  }, [])

  const showFlash = (message: string): void => {
    setFlash(message)
    if (flashTimer.current) window.clearTimeout(flashTimer.current)
    flashTimer.current = window.setTimeout(() => setFlash(null), 2200)
  }

  const ask = async (): Promise<void> => {
    const clean = text.trim()
    if (!clean || sending) return
    setSending(true)
    try {
      await window.igris.companion.ask(clean)
      setText('')
      showFlash('Draft opened in the workspace')
    } catch (error) {
      showFlash(error instanceof Error ? error.message : 'The workspace could not be opened.')
    } finally {
      setSending(false)
    }
  }

  const openWorkspace = async (): Promise<void> => {
    try {
      await window.igris.companion.openMain('/chat')
    } catch {
      showFlash('The workspace could not be opened.')
    }
  }

  const hide = async (): Promise<void> => {
    try {
      await window.igris.companion.hide()
    } catch {
      // The window may already be hiding.
    }
  }

  const status = state?.status ?? 'idle'
  const statusText =
    flash ??
    state?.statusText ??
    (state?.enabled ? 'Standing by' : 'Companion disabled')

  return (
    <div className={clsx('companion-root', `status-${status}`)}>
      <div className="companion-card">
        <header className="companion-head">
          <div className="companion-brand">
            <span className="companion-logo" aria-hidden>
              <span className="brand-ring" />
              <span className="brand-core" />
            </span>
            <div>
              <strong>IGRIS</strong>
              <span>COMPANION</span>
            </div>
          </div>
          <div className="companion-head-actions">
            {state?.alwaysOnTop ? (
              <span className="companion-pin" title="Always on top">
                <Pin size={11} />
              </span>
            ) : null}
            <button type="button" className="companion-icon-btn" aria-label="Hide companion" onClick={() => void hide()}>
              <Minus size={13} />
            </button>
          </div>
        </header>

        <div className="companion-stage">
          <div className="companion-halo" aria-hidden />
          <div className="companion-rings" aria-hidden>
            <span />
            <span />
            <span />
          </div>
          <div className="companion-bot" aria-hidden>
            <span className="bot-antenna">
              <i />
            </span>
            <div className="bot-head">
              <div className="bot-face">
                <span className="bot-eye bot-eye-left" />
                <span className="bot-eye bot-eye-right" />
                <span className="bot-mouth" />
              </div>
              <span className="bot-shine" />
            </div>
            <div className="bot-collar">
              <span />
              <span />
              <span />
            </div>
          </div>
          <div className={clsx('companion-status', `status-${status}`)}>
            <span className="companion-status-dot" />
            {statusText}
          </div>
        </div>

        <form
          className="companion-ask"
          onSubmit={(event) => {
            event.preventDefault()
            void ask()
          }}
        >
          <Sparkles size={13} className="companion-ask-icon" />
          <input
            ref={inputRef}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Ask IGRIS…"
            aria-label="Ask IGRIS"
            maxLength={4000}
          />
          <button type="submit" disabled={!text.trim() || sending} aria-label="Send to workspace">
            <SendHorizontal size={14} />
          </button>
        </form>

        <footer className="companion-foot">
          <button type="button" className="companion-open" onClick={() => void openWorkspace()}>
            <span>Open workspace</span>
            <ArrowUpRight size={12} />
          </button>
          <span className="companion-mode">
            <span className={clsx('status-led', state?.enabled && 'is-live')} />
            {state?.enabled ? 'LINKED' : 'PAUSED'}
          </span>
        </footer>
      </div>
    </div>
  )
}
