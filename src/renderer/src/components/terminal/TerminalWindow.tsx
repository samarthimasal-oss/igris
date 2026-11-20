import type { ReactNode } from 'react'
import clsx from 'clsx'

export function TerminalWindow({
  title = 'igris://terminal',
  status,
  actions,
  footer,
  children,
  className
}: {
  title?: string
  status?: ReactNode
  actions?: ReactNode
  footer?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={clsx('tw-window', className)}>
      <header className="tw-bar">
        <div className="tw-bar-left">
          <span className="tw-lights" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          <span className="tw-title">{title}</span>
        </div>
        <div className="tw-bar-right">
          {status ? <span className="tw-bar-status">{status}</span> : null}
          {actions}
        </div>
      </header>
      <div className="tw-body">{children}</div>
      {footer ? <footer className="tw-footer">{footer}</footer> : null}
    </section>
  )
}
