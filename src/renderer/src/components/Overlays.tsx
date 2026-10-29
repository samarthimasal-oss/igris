import {
  AlertTriangle,
  CheckCircle2,
  Info,
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
