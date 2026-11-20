import type { ReactNode } from 'react'
import clsx from 'clsx'

export function TerminalPrompt({
  path = 'igris',
  symbol = '❯',
  tone = 'default',
  className,
  children
}: {
  path?: string
  symbol?: string
  tone?: 'default' | 'muted' | 'accent'
  className?: string
  children?: ReactNode
}) {
  return (
    <span className={clsx('tw-prompt', `is-${tone}`, className)}>
      <span className="tw-prompt-user">operator</span>
      <span className="tw-prompt-at">@</span>
      <span className="tw-prompt-host">{path}</span>
      <span className="tw-prompt-colon">:</span>
      <span className="tw-prompt-symbol">{symbol}</span>
      {children ? <span className="tw-prompt-body">{children}</span> : null}
    </span>
  )
}
