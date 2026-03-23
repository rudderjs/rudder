'use client'

import { useState, useEffect } from 'react'

const CopyIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
  </svg>
)

const CheckIcon = () => (
  <svg className="w-3.5 h-3.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
)

export function CopyButton({ code, className = '' }: { code: string; className?: string }) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    void navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`text-xs text-muted-foreground hover:text-foreground transition-colors ${className}`}
      title={copied ? 'Copied!' : 'Copy'}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  )
}

export function CodeBlock({ code, language, title, lineNumbers, bare }: {
  code: string
  language?: string
  title?: string
  lineNumbers?: boolean
  /** When true, no outer border/rounding — used inside other elements like Example/Snippet */
  bare?: boolean
}) {
  const [html, setHtml] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    import('shiki').then(async ({ codeToHtml }) => {
      if (cancelled) return
      const result = await codeToHtml(code, {
        lang: language ?? 'text',
        themes: {
          light: 'github-light',
          dark: 'github-dark-high-contrast',
        },
        defaultColor: false,
      })
      if (!cancelled) setHtml(result)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [code, language])

  const lines = code.split('\n')
  const wrapCls = bare ? 'overflow-hidden' : 'rounded-xl border bg-card overflow-hidden'

  return (
    <div className={wrapCls}>
      {title && (
        <div className="px-4 py-2 border-b bg-muted/40 flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">{title}</span>
          <CopyButton code={code} />
        </div>
      )}
      <div className="relative">
        {!title && !bare && (
          <CopyButton code={code} className="absolute top-2 right-2 z-10" />
        )}
        {html ? (
          <div
            className="text-sm [&_pre]:!rounded-none [&_pre]:!m-0 [&_pre]:p-4 [&_pre]:overflow-x-auto [&_span]:!text-[var(--shiki-light)] dark:[&_span]:!text-[var(--shiki-dark)] [&_pre]:!bg-[var(--shiki-light-bg,#fff)] dark:[&_pre]:!bg-[var(--shiki-dark-bg,#24292e)]"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <div className="flex text-sm font-mono">
            {lineNumbers && (
              <div className="select-none text-right pr-4 pl-4 py-4 text-muted-foreground/40 border-r border-border/50 bg-muted/20">
                {lines.map((_, i) => <div key={i}>{i + 1}</div>)}
              </div>
            )}
            <pre className="p-4 overflow-x-auto flex-1"><code>{code}</code></pre>
          </div>
        )}
      </div>
    </div>
  )
}
