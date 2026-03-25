'use client'

import { useState, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { MediaRecord } from '../types.js'
import { categorize } from '../types.js'

interface FieldMeta {
  name:     string
  type:     string
  label:    string
  required: boolean
  readonly: boolean
  extra:    Record<string, unknown>
}

interface Props {
  field:    FieldMeta
  value:    unknown
  onChange: (value: unknown) => void
  disabled?: boolean
  panelPath?: string
}

export function MediaPickerInput({ field, value, onChange, disabled, panelPath }: Props) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<MediaRecord[]>([])
  const [breadcrumbs, setBreadcrumbs] = useState<Array<{ id: string; name: string }>>([])
  const [uploading, setUploading] = useState(false)
  const [activeLib, setActiveLib] = useState('')

  const isMultiple = field.extra['multiple'] === true
  const libraries = (field.extra['library'] as string[] | undefined) ?? ['default']
  const acceptFilter = field.extra['accept'] as string[] | undefined
  const showPreview = field.extra['preview'] !== false

  const pathSegment = (panelPath ?? '/admin').replace(/^\//, '')
  const apiBase = `/${pathSegment}/api/media`

  const selectedIds: string[] = Array.isArray(value) ? value as string[] : (value ? [String(value)] : [])

  // ── Fetch items ────────────────────────────────────────────

  const fetchItems = useCallback(async (parentId: string | null = null) => {
    const params = new URLSearchParams()
    if (parentId) params.set('parentId', parentId)
    params.set('scope', 'shared')
    const res = await fetch(`${apiBase}?${params}`)
    const data = await res.json() as { items: MediaRecord[]; breadcrumbs: Array<{ id: string; name: string }> }
    setItems(data.items)
    setBreadcrumbs(data.breadcrumbs)
  }, [apiBase])

  const openPicker = useCallback(async () => {
    if (disabled || field.readonly) return
    setActiveLib(libraries[0] ?? 'default')
    await fetchItems()
    setOpen(true)
  }, [disabled, field.readonly, libraries, fetchItems])

  const handleSelect = useCallback((item: MediaRecord) => {
    if (item.type === 'folder') { fetchItems(item.id); return }
    if (isMultiple) {
      const cur = [...selectedIds]
      onChange(cur.includes(item.id) ? cur.filter(id => id !== item.id) : [...cur, item.id])
    } else {
      onChange(item.id)
      setOpen(false)
    }
  }, [isMultiple, selectedIds, onChange, fetchItems])

  const handleUpload = useCallback(async (files: FileList | File[]) => {
    if (Array.from(files).length === 0) return
    setUploading(true)
    try {
      const fd = new FormData()
      for (const file of Array.from(files)) fd.append('files', file)
      fd.append('scope', 'shared')
      await fetch(`${apiBase}/upload`, { method: 'POST', body: fd })
      await fetchItems()
    } finally { setUploading(false) }
  }, [apiBase, fetchItems])

  const handleRemove = useCallback((id: string) => {
    onChange(isMultiple ? selectedIds.filter(i => i !== id) : null)
  }, [isMultiple, selectedIds, onChange])

  // ── Render ─────────────────────────────────────────────────

  return (
    <>
      {/* Selected files preview */}
      <div className="space-y-2">
        {selectedIds.length > 0 && showPreview && (
          <div className="flex flex-wrap gap-2">
            {selectedIds.map(id => (
              <SelectedThumb key={id} id={id} apiBase={apiBase} onRemove={() => handleRemove(id)} />
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={openPicker}
          disabled={disabled || field.readonly}
          className="text-sm px-3 py-2 rounded-md border bg-background hover:bg-muted transition-colors disabled:opacity-50"
        >
          {selectedIds.length > 0 ? 'Change' : 'Browse Media'}
        </button>
      </div>

      {/* Picker dialog — rendered via portal to escape form stacking context */}
      {open && typeof document !== 'undefined' && createPortal(
        <PickerDialog
          items={items}
          breadcrumbs={breadcrumbs}
          selectedIds={selectedIds}
          isMultiple={isMultiple}
          libraries={libraries}
          activeLib={activeLib}
          acceptFilter={acceptFilter ?? []}
          uploading={uploading}
          onSelect={handleSelect}
          onUpload={handleUpload}
          onNavigate={fetchItems}
          onLibChange={(lib) => { setActiveLib(lib); fetchItems() }}
          onClose={() => setOpen(false)}
        />,
        document.body,
      )}
    </>
  )
}

// ── Picker dialog ────────────────────────────────────────────

function PickerDialog({ items, breadcrumbs, selectedIds, isMultiple, libraries, activeLib, acceptFilter, uploading, onSelect, onUpload, onNavigate, onLibChange, onClose }: {
  items: MediaRecord[]
  breadcrumbs: Array<{ id: string; name: string }>
  selectedIds: string[]
  isMultiple: boolean
  libraries: string[]
  activeLib: string
  acceptFilter: string[]
  uploading: boolean
  onSelect: (item: MediaRecord) => void
  onUpload: (files: FileList) => void
  onNavigate: (parentId: string | null) => void
  onLibChange: (lib: string) => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/10 backdrop-blur-xs animate-in fade-in-0" onClick={onClose} />
      {/* Content — shadcn dialog style */}
      <div className="fixed z-50 grid w-full max-w-3xl max-h-[80vh] rounded-xl bg-background text-sm ring-1 ring-foreground/10 shadow-lg animate-in fade-in-0 zoom-in-95 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex flex-col gap-2 p-4 pb-0 shrink-0">
          <div className="flex items-center gap-3">
            <h3 className="text-base font-medium leading-none flex-1">Select Media</h3>

            {libraries.length > 1 && (
              <select value={activeLib} onChange={(e) => onLibChange(e.target.value)} className="text-xs rounded-md border bg-background px-2 py-1">
                {libraries.map(l => <option key={l} value={l}>{l.charAt(0).toUpperCase() + l.slice(1)}</option>)}
              </select>
            )}

            <label className="text-xs px-2.5 py-1 rounded-md bg-primary text-primary-foreground cursor-pointer hover:bg-primary/90 transition-colors shrink-0">
              Upload
              <input type="file" multiple accept={acceptFilter.length ? acceptFilter.join(',') : undefined} className="hidden" onChange={(e) => e.target.files && onUpload(e.target.files)} />
            </label>

            <button type="button" onClick={onClose} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              <span className="sr-only">Close</span>
            </button>
          </div>

          {/* Breadcrumbs */}
          <nav className="flex items-center gap-1 text-xs text-muted-foreground">
            <button type="button" onClick={() => onNavigate(null)} className="hover:text-foreground transition-colors">Root</button>
            {breadcrumbs.map(c => (
              <span key={c.id} className="flex items-center gap-1">
                <span>/</span>
                <button type="button" onClick={() => onNavigate(c.id)} className="hover:text-foreground transition-colors">{c.name}</button>
              </span>
            ))}
          </nav>
        </div>

        {uploading && (
          <div className="flex items-center gap-2 px-4 py-1.5 bg-primary/5 border-b text-xs shrink-0">
            <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            Uploading...
          </div>
        )}

        {/* Grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground text-sm">
              No files yet
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-3 sm:grid-cols-5 md:grid-cols-6">
              {items.map(item => {
                const isFolder = item.type === 'folder'
                const isImage = item.mime?.startsWith('image/') ?? false
                const isSelected = selectedIds.includes(item.id)

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelect(item)}
                    className={`flex flex-col items-center gap-2 rounded-lg p-2 transition-all ${
                      isSelected ? 'bg-primary/10 ring-2 ring-primary' : 'hover:bg-muted/50'
                    }`}
                  >
                    <div className="w-14 h-14 flex items-center justify-center rounded-lg bg-muted/50 overflow-hidden shrink-0">
                      {isImage && item.directory && item.filename ? (
                        <img src={`/storage/${item.directory}/${item.filename}`} alt={item.name} className="w-14 h-14 object-cover" loading="lazy" />
                      ) : (
                        <FileTypeIcon type={item.type} mime={item.mime} />
                      )}
                    </div>
                    <span className="w-full text-center text-[11px] truncate leading-tight">{item.name}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer — shadcn DialogFooter style */}
        {isMultiple && (
          <div className="flex items-center justify-between rounded-b-xl border-t bg-muted/50 px-4 py-3 shrink-0">
            <span className="text-sm text-muted-foreground">{selectedIds.length} selected</span>
            <button type="button" onClick={onClose} className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors">
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Selected thumbnail ───────────────────────────────────────

function SelectedThumb({ id, apiBase, onRemove }: { id: string; apiBase: string; onRemove: () => void }) {
  const [item, setItem] = useState<MediaRecord | null>(null)

  useEffect(() => {
    fetch(`${apiBase}/${id}`).then(r => r.json()).then((d: { item: MediaRecord }) => setItem(d.item)).catch(() => {})
  }, [apiBase, id])

  if (!item) return <div className="w-16 h-16 rounded-lg bg-muted animate-pulse shrink-0" />

  const isImage = item.mime?.startsWith('image/') ?? false

  return (
    <div className="relative group shrink-0">
      <div className="w-16 h-16 rounded-lg overflow-hidden bg-muted/50 flex items-center justify-center">
        {isImage && item.directory && item.filename ? (
          <img src={`/storage/${item.directory}/${item.filename}`} alt={item.name} className="w-16 h-16 object-cover" />
        ) : (
          <FileTypeIcon type={item.type} mime={item.mime} />
        )}
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
      >
        ✕
      </button>
    </div>
  )
}

// ── File type icon ───────────────────────────────────────────

function FileTypeIcon({ type, mime }: { type: string; mime: string | null }) {
  if (type === 'folder') return <svg className="w-6 h-6 text-amber-500" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>
  const cat = categorize(mime)
  const colors: Record<string, string> = { image: 'text-green-500', video: 'text-pink-500', audio: 'text-yellow-500', pdf: 'text-red-500', document: 'text-blue-500' }
  return <svg className={`w-6 h-6 ${colors[cat] ?? 'text-muted-foreground'}`} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6" /></svg>
}
