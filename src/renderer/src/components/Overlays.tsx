import {
  AlertTriangle,
  CheckCircle2,
  Info,
  MonitorUp,
  ShieldAlert,
  X,
  XCircle
} from 'lucide-react'
import { useAppStore } from '../lib/store'
import { Button, Modal } from './ui'
import clsx from 'clsx'
import type { ToastKind } from '../lib/store'

const TOAST_ICONS = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle
} satisfies Record<ToastKind, typeof Info>

const SCOPE_LABEL = {
  desktop: 'your desktop',
  browser: "IGRIS's managed browser",
  both: 'your desktop and IGRIS\'s managed browser'
} as const

function controlRequest(request: { toolName: string; argumentsPreview: string }): {
  goal: string
  scope: keyof typeof SCOPE_LABEL
} | null {
  if (request.toolName !== 'request_computer_control') return null
  try {
    const parsed = JSON.parse(request.argumentsPreview) as { goal?: unknown; scope?: unknown }
    const scope =
      parsed.scope === 'desktop' || parsed.scope === 'browser' || parsed.scope === 'both'
        ? parsed.scope
        : 'both'
    return {
      goal: typeof parsed.goal === 'string' ? parsed.goal : 'Complete this task.',
      scope
    }
  } catch {
    return { goal: 'Complete this task.', scope: 'both' }
  }
}

export function Toasts() {
  const toasts = useAppStore((state) => state.toasts)
  const dismiss = useAppStore((state) => state.dismissToast)

  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((toast) => {
        const Icon = TOAST_ICONS[toast.kind]
        return (
          <div key={toast.id} className={clsx('toast', `toast-${toast.kind}`)}>
            <Icon size={16} className="toast-icon" />
            <div className="toast-copy">
              <strong>{toast.title}</strong>
              {toast.message ? <p>{toast.message}</p> : null}
            </div>
            <button
              type="button"
              className="toast-close"
              aria-label="Dismiss notification"
              onClick={() => dismiss(toast.id)}
            >
              <X size={13} />
            </button>
          </div>
        )
      })}
    </div>
  )
}

export function ConfirmationPrompt() {
  const confirmations = useAppStore((state) => state.confirmations)
  const answerConfirmation = useAppStore((state) => state.answerConfirmation)
  const request = confirmations[0]

  if (!request) return null

  const control = controlRequest(request)

  if (control) {
    return (
      <Modal
        open
        title="Allow computer control for this task?"
        subtitle="IGRIS pauses here until you decide. Approval covers this task only."
        onClose={() => void answerConfirmation(request.id, false)}
        width={580}
        closeOnBackdrop={false}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => void answerConfirmation(request.id, false)}
            >
              Deny
            </Button>
            <Button
              variant="primary"
              icon={<MonitorUp size={15} />}
              onClick={() => void answerConfirmation(request.id, true)}
            >
              Allow for this task
            </Button>
          </>
        }
      >
        <div className="confirmation-head">
          <div className="confirmation-risk risk-high">
            <ShieldAlert size={18} />
            <span>Real mouse and keyboard access</span>
          </div>
          <span className="confirmation-tool">one task</span>
        </div>
        <h3 className="confirmation-title">{control.goal}</h3>
        <p className="confirmation-description">
          IGRIS may act on {SCOPE_LABEL[control.scope]} until the task ends, you press Stop, or 20
          minutes pass. It can see the screen while it works.
        </p>
        <div className="confirmation-preview">
          <span>Safety rules that always apply</span>
          <ul className="confirmation-rules">
            <li>Password fields, UAC and elevated windows, credential managers and IGRIS windows are blocked.</li>
            <li>Closing windows, typing into a shell, first-time app launches, and checkout or send actions ask again.</li>
            <li>Browser downloads and uploads are blocked. IGRIS uses its own Edge profile, never your normal one.</li>
            <li>Stop any time from the control bar or with Ctrl+Alt+Shift+X.</li>
          </ul>
        </div>
        <p className="confirmation-footnote">
          Nothing runs until you allow it. You can revoke computer-control permissions at any time in
          Settings → Permissions.
        </p>
      </Modal>
    )
  }

  return (
    <Modal
      open
      title="Permission required"
      subtitle="IGRIS is paused until you decide."
      onClose={() => void answerConfirmation(request.id, false)}
      width={560}
      closeOnBackdrop={false}
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => void answerConfirmation(request.id, false)}
          >
            Deny
          </Button>
          <Button
            variant={request.risk === 'high' ? 'danger' : 'primary'}
            icon={<ShieldAlert size={15} />}
            onClick={() => void answerConfirmation(request.id, true)}
          >
            Allow this action
          </Button>
        </>
      }
    >
      <div className="confirmation-head">
        <div className={clsx('confirmation-risk', `risk-${request.risk}`)}>
          <ShieldAlert size={18} />
          <span>{request.risk === 'high' ? 'High impact' : 'Sensitive action'}</span>
        </div>
        <span className="confirmation-tool">{request.toolName}</span>
      </div>
      <h3 className="confirmation-title">{request.title}</h3>
      <p className="confirmation-description">{request.description}</p>
      <div className="confirmation-preview">
        <span>Requested action</span>
        <pre>{request.argumentsPreview}</pre>
      </div>
      <p className="confirmation-footnote">
        This approval applies to this action only. You can revoke capabilities at any time in
        Settings → Permissions.
      </p>
    </Modal>
  )
}
