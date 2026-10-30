import { useState } from 'react'

export function MiniApp() {
  const [opening, setOpening] = useState(false)

  const restore = async (): Promise<void> => {
    if (opening) return
    setOpening(true)
    try {
      await window.igris.mini.restore()
    } catch {
      setOpening(false)
    }
  }

  return (
    <main className="mini-root">
      <span className="mini-halo" aria-hidden />
      <section className="mini-bubble" aria-label="IGRIS is minimized">
        <button
          type="button"
          className="mini-bot"
          onClick={() => void restore()}
          aria-label="Open IGRIS"
          title="Open IGRIS"
          disabled={opening}
        >
          <span className="mini-antenna" aria-hidden>
            <span className="mini-antenna-tip" />
          </span>
          <span className="mini-head" aria-hidden>
            <span className="mini-ear mini-ear-left" />
            <span className="mini-ear mini-ear-right" />
            <span className="mini-face">
              <span className="mini-eye mini-eye-left" />
              <span className="mini-eye mini-eye-right" />
              <span className="mini-mouth" />
            </span>
          </span>
          <span className="mini-label" aria-hidden>
            IGRIS
          </span>
        </button>
        <span className="mini-live" aria-hidden />
      </section>
    </main>
  )
}
