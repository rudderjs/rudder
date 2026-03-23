'use client'

import { useState, useEffect } from 'react'

interface Props {
  mime: string | null
  url: string
  name: string
}

export function PreviewContent({ mime, url, name }: Props) {
  if (!mime) return <FallbackPreview name={name} />

  if (mime.startsWith('image/'))
    return <img src={url} alt={name} className="max-w-full max-h-[70vh] object-contain rounded-lg shadow" />

  if (mime.startsWith('video/'))
    return <video src={url} controls className="max-w-full max-h-[70vh] rounded-lg shadow" />

  if (mime.startsWith('audio/'))
    return (
      <div className="text-center space-y-4">
        <div className="w-24 h-24 mx-auto rounded-full bg-primary/10 flex items-center justify-center">
          <svg className="w-10 h-10 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" /></svg>
        </div>
        <audio src={url} controls className="w-80" />
      </div>
    )

  if (mime === 'application/pdf')
    return <iframe src={url} className="w-full h-[75vh] rounded-lg border" title={name} />

  if (mime.startsWith('text/') || mime === 'application/json' || mime === 'application/xml')
    return <TextPreview url={url} mime={mime} />

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
        const lines = text.trim().split('\n').slice(0, 100)
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
