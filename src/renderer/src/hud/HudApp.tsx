import { useEffect, useState, type JSX } from 'react'
import type { ControlSessionState } from '@shared/types'

function formatElapsed(startedAt: string, now: number): string {
  const start = new Date(startedAt).getTime()
  if (!Number.isFinite(start)) return '0:00'
  const total = Math.max(0, Math.floor((now - start) / 1000))
  const minutes = Math.floor(total / 60)
  return `${minutes}:${String(total % 60).padStart(2, '0')}`
}

const SCOPE_LABEL: Record<ControlSessionState['scope'], string> = {
  desktop: 'DESKTOP',
  browser: 'BROWSER',
  both: 'DESKTOP + BROWSER'
}

export function HudApp(): JSX.Element | null {
  const [state, setState] = useState<ControlSessionState | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    void window.igris.control
      .state()
      .then((next) => {
        if (alive) setState(next)
      })
      .catch(() => undefined)
    const unsubscribe = window.igris.events.onControl((event) => setState(event.state))
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => {
      alive = false
      unsubscribe()
      window.clearInterval(timer)
    }
  }, [])

  if (!state) return null

  const paused = state.status === 'paused'
  const ratio = Math.min(1, state.maxActions > 0 ? state.actions / state.maxActions : 0)
  const elapsed = formatElapsed(state.startedAt, now)

  const toggle = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      if (paused) await window.igris.control.resume()
      else await window.igris.control.pause()
    } catch {
      // The session may have ended between the click and the call.
    } finally {
      setBusy(false)
    }
  }

  const stop = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      await window.igris.control.stop()
    } catch {
      // Stop is best effort; the window hides when the session ends.
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`hud ${paused ? 'hud-paused' : ''}`}>
      <div className="hud-head">
        <span className="hud-label">
          <span className="hud-dot" aria-hidden="true" />
          CONTROL
        </span>
        <span className="hud-scope">{SCOPE_LABEL[state.scope]}</span>
        <span className="hud-elapsed" title="Elapsed time">
          {elapsed}
        </span>
        <div className="hud-actions">
          <button
            type="button"
            className="hud-button hud-toggle"
            onClick={() => void toggle()}
            disabled={busy}
            aria-label={paused ? 'Resume computer control' : 'Pause computer control'}
          >
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button
            type="button"
            className="hud-button hud-stop"
            onClick={() => void stop()}
            disabled={busy}
            aria-label="Stop computer control"
          >
            Stop
          </button>
        </div>
      </div>
      <div className="hud-goal" title={state.goal}>
        {state.goal}
      </div>
      <div className="hud-action" title={state.currentAction ?? ''}>
        {paused ? 'Paused — no new actions will run.' : (state.currentAction ?? 'Waiting for the next action…')}
      </div>
      <div className="hud-foot">
        <div className="hud-track" aria-hidden="true">
          <span style={{ width: `${Math.max(2, ratio * 100)}%` }} />
        </div>
        <span className="hud-count">
          {state.actions} / {state.maxActions}
        </span>
      </div>
    </div>
  )
}
