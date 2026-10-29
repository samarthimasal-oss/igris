import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes
} from 'react'
import { createPortal } from 'react-dom'
import {
  AlertTriangle,
  Check,
  Loader2,
  X,
  type LucideIcon
} from 'lucide-react'
import clsx from 'clsx'

// ---------------------------------------------------------------- buttons

type ButtonVariant = 'primary' | 'default' | 'ghost' | 'danger' | 'subtle'
type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  icon?: ReactNode
  trailingIcon?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', size = 'md', loading, icon, trailingIcon, className, children, disabled, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type={props.type ?? 'button'}
      className={clsx('btn', `btn-${variant}`, `btn-${size}`, loading && 'is-loading', className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Loader2 className="btn-spinner" size={15} /> : icon ? <span className="btn-icon">{icon}</span> : null}
      {children ? <span className="btn-label">{children}</span> : null}
      {trailingIcon ? <span className="btn-icon">{trailingIcon}</span> : null}
    </button>
  )
})

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  size?: 'sm' | 'md'
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, size = 'md', className, children, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type={props.type ?? 'button'}
      className={clsx('icon-btn', `icon-btn-${size}`, className)}
      aria-label={label}
      title={label}
      {...props}
    >
      {children}
    </button>
  )
})

// ---------------------------------------------------------------- surfaces

export function Card({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={clsx('card', className)} {...props}>
      {children}
    </div>
  )
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className
}: {
  eyebrow?: string
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <header className={clsx('page-header', className)}>
      <div className="page-header-copy">
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h1 className="page-title">{title}</h1>
        {description ? <p className="page-description">{description}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  )
}

export function SectionHeading({
  title,
  description,
  actions,
  className
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <div className={clsx('section-heading', className)}>
      <div>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="section-actions">{actions}</div> : null}
    </div>
  )
}

// ---------------------------------------------------------------- display

type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'violet'

export function Badge({
  children,
  tone = 'neutral',
  dot = false,
  className
}: {
  children: ReactNode
  tone?: BadgeTone
  dot?: boolean
  className?: string
}) {
  return (
    <span className={clsx('badge', `badge-${tone}`, className)}>
      {dot ? <span className="badge-dot" /> : null}
      {children}
    </span>
  )
}

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={clsx('spin', className)} aria-hidden />
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className
}: {
  icon: LucideIcon
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={clsx('empty-state', className)}>
      <div className="empty-state-icon">
        <Icon size={22} strokeWidth={1.6} />
      </div>
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
      {action ? <div className="empty-state-action">{action}</div> : null}
    </div>
  )
}

export function Alert({
  tone = 'warning',
  title,
  children,
  action
}: {
  tone?: 'info' | 'warning' | 'danger' | 'success'
  title?: ReactNode
  children?: ReactNode
  action?: ReactNode
}) {
  const Icon = tone === 'success' ? Check : AlertTriangle
  return (
    <div className={clsx('alert', `alert-${tone}`)}>
      <Icon size={17} className="alert-icon" />
      <div className="alert-body">
        {title ? <strong>{title}</strong> : null}
        {children ? <div>{children}</div> : null}
      </div>
      {action ? <div className="alert-action">{action}</div> : null}
    </div>
  )
}

export function KeyValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="kv-row">
      <span className="kv-label">{label}</span>
      <span className="kv-value">{children}</span>
    </div>
  )
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={clsx('mono', className)}>{children}</span>
}

// ---------------------------------------------------------------- inputs

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
  className
}: {
  label?: ReactNode
  hint?: ReactNode
  error?: ReactNode
  children: ReactNode
  htmlFor?: string
  className?: string
}) {
  return (
    <div className={clsx('field', className)}>
      {label ? (
        <label className="field-label" htmlFor={htmlFor}>
          {label}
        </label>
      ) : null}
      {children}
      {error ? <div className="field-error">{error}</div> : null}
      {hint ? <div className="field-hint">{hint}</div> : null}
    </div>
  )
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={clsx('input', className)} {...props} />
  }
)

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return <textarea ref={ref} className={clsx('input', 'textarea', className)} {...props} />
  }
)

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <select ref={ref} className={clsx('input', 'select', className)} {...props}>
        {children}
      </select>
    )
  }
)

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
  tone = 'default'
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label?: ReactNode
  description?: ReactNode
  disabled?: boolean
  tone?: 'default' | 'danger'
}) {
  const id = useId()
  return (
    <div className={clsx('toggle-row', disabled && 'is-disabled')}>
      {label || description ? (
        <div className="toggle-copy">
          {label ? (
            <label className="toggle-label" htmlFor={id}>
              {label}
            </label>
          ) : null}
          {description ? <p className="toggle-description">{description}</p> : null}
        </div>
      ) : null}
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        className={clsx('toggle', tone === 'danger' && 'toggle-danger', checked && 'is-on')}
        onClick={() => onChange(!checked)}
      >
        <span className="toggle-thumb" />
      </button>
    </div>
  )
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel
}: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
  ariaLabel?: string
}) {
  return (
    <div className="segmented" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={clsx('segmented-item', value === option.value && 'is-active')}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function Slider({
  value,
  min,
  max,
  step,
  onChange,
  label,
  valueLabel
}: {
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
  label?: ReactNode
  valueLabel?: ReactNode
}) {
  return (
    <div className="slider-field">
      {label || valueLabel ? (
        <div className="slider-header">
          <span>{label}</span>
          <span className="slider-value">{valueLabel ?? value}</span>
        </div>
      ) : null}
      <input
        type="range"
        className="slider"
        min={min}
        max={max}
        step={step ?? 1}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  )
}

// ---------------------------------------------------------------- tabs

export function Tabs<T extends string>({
  value,
  items,
  onChange,
  className
}: {
  value: T
  items: Array<{ value: T; label: ReactNode; count?: number }>
  onChange: (value: T) => void
  className?: string
}) {
  return (
    <div className={clsx('tabs', className)} role="tablist">
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          role="tab"
          aria-selected={value === item.value}
          className={clsx('tab', value === item.value && 'is-active')}
          onClick={() => onChange(item.value)}
        >
          {item.label}
          {item.count !== undefined ? <span className="tab-count">{item.count}</span> : null}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- modal

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = 620,
  className,
  closeOnBackdrop = true
}: {
  open: boolean
  onClose: () => void
  title?: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
  width?: number
  className?: string
  closeOnBackdrop?: boolean
}) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const timer = window.setTimeout(() => {
      const focusable = panelRef.current?.querySelector<HTMLElement>(
        'input, textarea, select, button, [tabindex]:not([tabindex="-1"])'
      )
      focusable?.focus()
    }, 40)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.clearTimeout(timer)
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        className={clsx('modal', className)}
        style={{ width }}
        role="dialog"
        aria-modal="true"
      >
        {title ? (
          <header className="modal-header">
            <div>
              <h2>{title}</h2>
              {subtitle ? <p>{subtitle}</p> : null}
            </div>
            <IconButton label="Close dialog" size="sm" onClick={onClose}>
              <X size={16} />
            </IconButton>
          </header>
        ) : null}
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-footer">{footer}</footer> : null}
      </div>
    </div>,
    document.body
  )
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  tone = 'danger',
  busy,
  onCancel,
  onConfirm
}: {
  open: boolean
  title: ReactNode
  description: ReactNode
  confirmLabel?: string
  tone?: 'danger' | 'primary'
  busy?: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      width={480}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="confirm-copy">{description}</div>
    </Modal>
  )
}
