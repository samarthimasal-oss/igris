import type { ReactNode, RefObject } from 'react'
import clsx from 'clsx'
import type { TerminalLine, TerminalTone } from '../../lib/terminal'
import { tonePrefix } from '../../lib/terminal'

export function TerminalOutput({
  children,
  scrollRef,
  className
}: {
  children: ReactNode
  scrollRef?: RefObject<HTMLDivElement | null>
  className?: string
}) {
  return (
    <div className={clsx('tw-output', className)} ref={scrollRef} role="log" aria-live="polite">
      {children}
    </div>
  )
}

export function TerminalLineGroup({ lines }: { lines: TerminalLine[] }) {
  return (
    <div className="tw-lines">
      {lines.map((line, index) => (
        <p key={`${index}-${line.text.slice(0, 18)}`} className={clsx('tw-line', `is-${line.tone ?? 'info'}`)}>
          <span className="tw-line-prefix" aria-hidden>
            {tonePrefix(line.tone ?? 'info')}
          </span>
          <span>{line.text}</span>
        </p>
      ))}
    </div>
  )
}
