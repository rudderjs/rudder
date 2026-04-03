'use client'

import { useState, useEffect, useCallback } from 'react'
import type { MediaRecord, ConversionInfo } from '@rudderjs/media'
import { formatSize, formatDate } from '../_lib/format.js'
import { PreviewContent } from './PreviewContent.js'

interface Props {
  item: MediaRecord
  items: MediaRecord[]
  onClose: () => void
  onNavigate: (item: MediaRecord) => void
  onDelete: (id: string) => void
  onUpdate: (id: string, data: Record<string, unknown>) => Promise<void>
  panelPath: string
}

export function MediaPreview({ item, items, onClose, onNavigate, onDelete, onUpdate, panelPath }: Props) {
  const [editingAlt, setEditingAlt] = useState(false)
  const [altText, setAltText] = useState(item.alt ?? '')

  const fileUrl = `/storage/${item.directory}/${item.filename}`
  const currentIndex = items.findIndex(i => i.id === item.id)

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
    setAltText(item.alt ?? '')
    setEditingAlt(false)
  }, [item])

  const handleSaveAlt = useCallback(async () => {
    await onUpdate(item.id, { alt: altText })
    setEditingAlt(false)
  }, [item.id, altText, onUpdate])

  const handleCopyUrl = useCallback(() => {
    navigator.clipboard.writeText(window.location.origin + fileUrl).catch(() => {})
  }, [fileUrl])

  const conversions = parseConversions(item.conversions)

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
          <PreviewContent mime={item.mime} url={fileUrl} name={item.name} />
        </div>

        {/* Metadata sidebar */}
        <aside className="w-72 shrink-0 border-l overflow-y-auto p-5 space-y-5">
          <div>
            <h3 className="text-sm font-semibold truncate">{item.name}</h3>
            <p className="text-xs text-muted-foreground mt-1">{item.mime ?? 'Unknown type'}</p>
          </div>

          <div className="space-y-2 text-xs">
            {item.size && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Size</span>
                <span>{formatSize(item.size)}</span>
              </div>
            )}
            {item.width && item.height && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Dimensions</span>
                <span>{item.width} × {item.height}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Modified</span>
              <span>{formatDate(item.updatedAt)}</span>
            </div>
          </div>

          {/* Alt text (images) */}
          {item.mime?.startsWith('image/') && (
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
          {conversions.length > 0 && (
            <div>
              <label className="text-xs font-medium text-muted-foreground">Conversions</label>
              <div className="mt-1 space-y-1">
                {conversions.map((conv) => (
                  <div key={conv.name} className="flex items-center justify-between text-xs">
                    <span>{conv.name}</span>
                    <span className="text-muted-foreground">{conv.width}×{conv.height}</span>
                  </div>
                ))}
              </div>
            </div>
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
              download={item.name}
              className="block text-xs px-2 py-1.5 rounded hover:bg-muted transition-colors"
            >
              Download
            </a>
            <button
              onClick={() => { onDelete(item.id); onClose() }}
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

function parseConversions(raw: ConversionInfo[] | string): ConversionInfo[] {
  if (!raw) return []
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) } catch { return [] }
  }
  return raw
}
