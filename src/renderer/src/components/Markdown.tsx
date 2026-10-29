import { isValidElement, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { Check, Copy } from 'lucide-react'

function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children)
  return ''
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false)
  const raw = textOf(children).replace(/\n$/, '')
  const language =
    (isValidElement<{ className?: string }>(children) &&
      children.props.className?.match(/language-([\w-]+)/)?.[1]) ||
    'code'

  const copy = async (): Promise<void> => {
    try {
      if (window.igris) await window.igris.system.copyText(raw)
      else await navigator.clipboard.writeText(raw)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      // Clipboard access is best-effort.
    }
  }

  return (
    <div className="code-block">
      <div className="code-block-bar">
        <span>{language}</span>
        <button type="button" onClick={() => void copy()} className="code-copy">
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  )
}

export function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]}
        components={{
          pre: ({ children: preChildren }) => <CodeBlock>{preChildren}</CodeBlock>,
          code: ({ className, children: codeChildren, ...props }) => {
            const isBlock = Boolean(className)
            return (
              <code className={className ?? (isBlock ? undefined : 'inline-code')} {...props}>
                {codeChildren}
              </code>
            )
          },
          a: ({ href, children: linkChildren }) => (
            <a
              href={href}
              onClick={(event) => {
                event.preventDefault()
                if (href && /^https?:\/\//i.test(href) && window.igris) {
                  void window.igris.system.openExternal(href)
                }
              }}
            >
              {linkChildren}
            </a>
          ),
          img: ({ src, alt }) => (
            <span className="markdown-image">
              {alt ?? 'Image'}
              {src ? (
                <button
                  type="button"
                  className="link-button"
                  onClick={() => {
                    if (src && /^https?:\/\//i.test(src) && window.igris) {
                      void window.igris.system.openExternal(src)
                    }
                  }}
                >
                  Open source
                </button>
              ) : null}
            </span>
          )
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}

export function MessageText({ content }: { content: string }) {
  if (!content.trim()) return null
  return <Markdown>{content}</Markdown>
}

export function plainPreview(content: string, max = 90): string {
  const clean = content
    .replace(/```[\s\S]*?```/g, ' code ')
    .replace(/[#>*_`[\]()]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (clean.length <= max) return clean
  return `${clean.slice(0, max).trimEnd()}…`
}
