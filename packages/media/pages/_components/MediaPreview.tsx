'use client'

import { useState, useEffect, useCallback } from 'react'

interface Props {
  item: Record<string, unknown>
  items: Array<Record<string, unknown>> // all files for arrow navigation
  onClose: () => void
  onNavigate: (item: Record<string, unknown>) => void
  onDelete: (id: string) => void
  onUpdate: (id: string, data: Record<string, unknown>) => Promise<void>
  panelPath: string
}

export function MediaPreview({ item, items, onClose, onNavigate, onDelete, onUpdate, panelPath }: Props) {
  const [editingAlt, setEditingAlt] = useState(false)
  const [altText, setAltText] = useState((item['alt'] as string) ?? '')

  const id = item['id'] as string
  const name = item['name'] as string
  const mime = item['mime'] as string | null
  const size = item['size'] as number | null
  const width = item['width'] as number | null
  const height = item['height'] as number | null
  const directory = item['directory'] as string
  const filename = item['filename'] as string
  const updatedAt = item['updatedAt'] as string

  const fileUrl = `/storage/${directory}/${filename}`

  // Current index for arrow navigation
  const currentIndex = items.findIndex(i => i['id'] === id)

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft' && currentIndex > 0) {
        const prev = items[currentIndex - 1]
        if (prev) onNavigate(prev)
      }
      if (e.key === 'ArrowRight' && currentIndex < items.length - 1) {
        const next = items[currentIndex + 1]
        if (next) onNavigate(next)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [currentIndex, items, onClose, onNavigate])

  // Reset alt text when item changes
  useEffect(() => {
    setAltText((item['alt'] as string) ?? '')
    setEditingAlt(false)
  }, [item])

  const handleSaveAlt = useCallback(async () => {
    await onUpdate(id, { alt: altText })
    setEditingAlt(false)
  }, [id, altText, onUpdate])

  const handleCopyUrl = useCallback(() => {
    navigator.clipboard.writeText(window.location.origin + fileUrl).catch(() => {})
  }, [fileUrl])

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative ml-auto flex w-full max-w-4xl bg-background shadow-2xl">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 z-10 rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>

        {/* Arrow navigation */}
        {currentIndex > 0 && (
          <button
            onClick={() => { const prev = items[currentIndex - 1]; if (prev) onNavigate(prev) }}
            className="absolute left-4 top-1/2 -translate-y-1/2 z-10 rounded-full bg-background/80 p-2 shadow hover:bg-background transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
        )}
        {currentIndex < items.length - 1 && (
          <button
            onClick={() => { const next = items[currentIndex + 1]; if (next) onNavigate(next) }}
            className="absolute right-80 top-1/2 -translate-y-1/2 z-10 rounded-full bg-background/80 p-2 shadow hover:bg-background transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          </button>
        )}

        {/* Preview area */}
        <div className="flex-1 flex items-center justify-center p-8 overflow-auto bg-muted/30">
          <PreviewContent mime={mime} url={fileUrl} name={name} />
        </div>

        {/* Metadata sidebar */}
        <aside className="w-72 shrink-0 border-l overflow-y-auto p-5 space-y-5">
          <div>
            <h3 className="text-sm font-semibold truncate">{name}</h3>
            <p className="text-xs text-muted-foreground mt-1">{mime ?? 'Unknown type'}</p>
          </div>

          <div className="space-y-2 text-xs">
            {size && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Size</span>
                <span>{formatSize(size)}</span>
              </div>
            )}
            {width && height && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Dimensions</span>
                <span>{width} × {height}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Modified</span>
              <span>{formatDate(updatedAt)}</span>
            </div>
          </div>

          {/* Alt text (images) */}
          {mime?.startsWith('image/') && (
            <div>
              <label className="text-xs font-medium text-muted-foreground">Alt text</label>
              {editingAlt ? (
                <div className="mt-1 space-y-1">
                  <textarea
                    value={altText}
                    onChange={(e) => setAltText(e.target.value)}
                    className="w-full rounded-md border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                    rows={2}
                    autoFocus
                  />
                  <div className="flex gap-1">
                    <button onClick={handleSaveAlt} className="text-xs px-2 py-1 rounded bg-primary text-primary-foreground">Save</button>
                    <button onClick={() => setEditingAlt(false)} className="text-xs px-2 py-1 rounded border">Cancel</button>
                  </div>
                </div>
              ) : (
                <p
                  className="mt-1 text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
                  onClick={() => setEditingAlt(true)}
                >
                  {altText || 'Click to add alt text...'}
                </p>
              )}
            </div>
          )}

          {/* Conversions */}
          {item['conversions'] && (
            (() => {
              const convs = (typeof item['conversions'] === 'string'
                ? JSON.parse(item['conversions'] as string)
                : item['conversions']) as Array<{ name: string; filename: string; width: number; height: number; size: number }>
              if (!convs.length) return null
              return (
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Conversions</label>
                  <div className="mt-1 space-y-1">
                    {convs.map((conv) => (
                      <div key={conv.name} className="flex items-center justify-between text-xs">
                        <span>{conv.name}</span>
                        <span className="text-muted-foreground">{conv.width}×{conv.height}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })()
          )}

          {/* Actions */}
          <div className="space-y-1 pt-2 border-t">
            <button
              onClick={handleCopyUrl}
              className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted transition-colors"
            >
              Copy URL
            </button>
            <a
              href={fileUrl}
              download={name}
              className="block text-xs px-2 py-1.5 rounded hover:bg-muted transition-colors"
            >
              Download
            </a>
            <button
              onClick={() => { onDelete(id); onClose() }}
              className="w-full text-left text-xs px-2 py-1.5 rounded text-destructive hover:bg-muted transition-colors"
            >
              Delete
            </button>
          </div>
        </aside>
      </div>
    </div>
  )
}

// ── Preview renderer by MIME type ────────────────────────────

function PreviewContent({ mime, url, name }: { mime: string | null; url: string; name: string }) {
  if (!mime) return <FallbackPreview name={name} />

  // Images
  if (mime.startsWith('image/'))
    return <img src={url} alt={name} className="max-w-full max-h-[70vh] object-contain rounded-lg shadow" />

  // Video
  if (mime.startsWith('video/'))
    return <video src={url} controls className="max-w-full max-h-[70vh] rounded-lg shadow" />

  // Audio
  if (mime.startsWith('audio/'))
    return (
      <div className="text-center space-y-4">
        <div className="w-24 h-24 mx-auto rounded-full bg-primary/10 flex items-center justify-center">
          <svg className="w-10 h-10 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" /></svg>
        </div>
        <audio src={url} controls className="w-80" />
      </div>
    )

  // PDF
  if (mime === 'application/pdf')
    return <iframe src={url} className="w-full h-[75vh] rounded-lg border" title={name} />

  // Text, JSON, XML, Markdown, Code
  if (mime.startsWith('text/') || mime === 'application/json' || mime === 'application/xml')
    return <TextPreview url={url} mime={mime} />

  // CSV
  if (mime.includes('csv'))
    return <CsvPreview url={url} />

  return <FallbackPreview name={name} />
}

// ── Text file preview ────────────────────────────────────────

function TextPreview({ url, mime }: { url: string; mime: string }) {
  const [content, setContent] = useState<string | null>(null)

  useEffect(() => {
    fetch(url)
      .then(r => r.text())
      .then(setContent)
      .catch(() => setContent('Failed to load file.'))
  }, [url])

  if (content === null) return <div className="animate-pulse bg-muted/30 rounded w-96 h-64" />

  const isJson = mime === 'application/json'
  let display = content
  if (isJson) {
    try { display = JSON.stringify(JSON.parse(content), null, 2) } catch { /* use raw */ }
  }

  return (
    <pre className="w-full max-w-2xl max-h-[70vh] overflow-auto rounded-lg bg-muted p-4 text-xs font-mono whitespace-pre-wrap">
      {display}
    </pre>
  )
}

// ── CSV preview ──────────────────────────────────────────────

function CsvPreview({ url }: { url: string }) {
  const [rows, setRows] = useState<string[][] | null>(null)

  useEffect(() => {
    fetch(url)
      .then(r => r.text())
      .then(text => {
        const lines = text.trim().split('\n').slice(0, 100) // max 100 rows
        setRows(lines.map(line => line.split(',')))
      })
      .catch(() => setRows([]))
  }, [url])

  if (rows === null) return <div className="animate-pulse bg-muted/30 rounded w-96 h-64" />
  if (rows.length === 0) return <p className="text-muted-foreground text-sm">Empty file.</p>

  const header = rows[0]
  const body = rows.slice(1)

  return (
    <div className="max-w-3xl max-h-[70vh] overflow-auto rounded-lg border">
      <table className="w-full text-xs">
        {header && (
          <thead className="bg-muted/50 sticky top-0">
            <tr>
              {header.map((cell, i) => (
                <th key={i} className="px-3 py-2 text-left font-medium text-muted-foreground">{cell}</th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {body.map((row, ri) => (
            <tr key={ri} className="border-t">
              {row.map((cell, ci) => (
                <td key={ci} className="px-3 py-1.5 text-muted-foreground">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Fallback ─────────────────────────────────────────────────

function FallbackPreview({ name }: { name: string }) {
  return (
    <div className="text-center space-y-3 text-muted-foreground">
      <svg className="w-20 h-20 mx-auto opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
      <p className="text-sm font-medium">{name}</p>
      <p className="text-xs">Preview not available</p>
    </div>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(d: string): string {
  try { return new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(d)) }
  catch { return d }
}
