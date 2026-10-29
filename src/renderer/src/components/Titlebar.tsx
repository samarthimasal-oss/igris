import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Minimize2, Square, X } from 'lucide-react'

const TITLES: Array<{ match: (path: string) => boolean; label: string }> = [
  { match: (path) => path === '/', label: 'Command deck' },
  { match: (path) => path.startsWith('/chat/'), label: 'Conversation' },
  { match: (path) => path.startsWith('/chat'), label: 'Conversation' },
  { match: (path) => path.startsWith('/projects'), label: 'Projects' },
  { match: (path) => path.startsWith('/computer'), label: 'Computer control' },
  { match: (path) => path.startsWith('/models'), label: 'AI models' },
  { match: (path) => path.startsWith('/tools'), label: 'Toolkit' },
  { match: (path) => path.startsWith('/activity'), label: 'Activity' },
  { match: (path) => path.startsWith('/settings'), label: 'Settings' }
]

export function Titlebar() {
  const location = useLocation()
  const [maximized, setMaximized] = useState(false)
  const label = TITLES.find((entry) => entry.match(location.pathname))?.label ?? 'IGRIS'

  const control = async (action: 'minimize' | 'maximize' | 'close'): Promise<void> => {
    try {
      if (!window.igris) return
      const result = await window.igris.system.windowControl(action)
      if (action === 'maximize') setMaximized(result.maximized)
    } catch {
      // Window controls are optional in a preview environment.
    }
  }

  return (
    <header
      className="titlebar"
      onDoubleClick={(event) => {
        if ((event.target as HTMLElement).closest('button')) return
        void control('maximize')
      }}
    >
      <div className="titlebar-brand">
        <span className="brand-mark" aria-hidden>
          <span className="brand-ring" />
          <span className="brand-core" />
        </span>
        <span className="brand-name">IGRIS</span>
        <span className="brand-tag">PERSONAL INTELLIGENCE</span>
      </div>
      <div className="titlebar-center">
        <span className="titlebar-page">{label}</span>
      </div>
      <div className="titlebar-right">
        <span className="titlebar-status">
          <span className="status-led" />
          LOCAL CORE
        </span>
        <div className="window-controls">
          <button
            type="button"
            className="window-btn"
            aria-label="Minimize"
            onClick={() => void control('minimize')}
          >
            <Minimize2 size={13} />
          </button>
          <button
            type="button"
            className="window-btn"
            aria-label={maximized ? 'Restore' : 'Maximize'}
            onClick={() => void control('maximize')}
          >
            <Square size={11} />
          </button>
          <button
            type="button"
            className="window-btn window-close"
            aria-label="Close"
            onClick={() => void control('close')}
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </header>
  )
}
