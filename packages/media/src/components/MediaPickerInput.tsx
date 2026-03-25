'use client'

import { useState, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { MediaRecord } from '../types.js'
import { categorize } from '../types.js'
import { getLibrary, getDefaultLibrary, type MediaLibrary } from '../registry.js'

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

  const isMultiple = field.extra['multiple'] === true
  const libraries = (field.extra['library'] as string[] | undefined) ?? ['default']
  const showPreview = field.extra['preview'] !== false

  const pathSegment = (panelPath ?? '/admin').replace(/^\//, '')
  const apiBase = `/${pathSegment}/api/media`

  const selectedIds: string[] = Array.isArray(value) ? value as string[] : (value ? [String(value)] : [])

  const handleRemove = useCallback((id: string) => {
    onChange(isMultiple ? selectedIds.filter(i => i !== id) : null)
  }, [isMultiple, selectedIds, onChange])

  // Build library meta for the embedded MediaElement
  const libraryMetas = libraries.map(name => {
    const lib = getLibrary(name) ?? getDefaultLibrary()
    return { name, ...lib }
  })

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
          onClick={() => { if (!disabled && !field.readonly) setOpen(true) }}
          disabled={disabled || field.readonly}
          className="text-sm px-3 py-2 rounded-md border bg-background hover:bg-muted transition-colors disabled:opacity-50"
        >
          {selectedIds.length > 0 ? 'Change' : 'Browse Media'}
        </button>
      </div>

      {/* Picker dialog — portal to escape form stacking context */}
      {open && typeof document !== 'undefined' && createPortal(
        <PickerDialog
          libraries={libraryMetas}
          isMultiple={isMultiple}
          selectedIds={selectedIds}
          panelPath={`/${pathSegment}`}
          onSelect={(item: MediaRecord) => {
            if (isMultiple) {
              const cur = [...selectedIds]
              onChange(cur.includes(item.id) ? cur.filter(i => i !== item.id) : [...cur, item.id])
            } else {
              onChange(item.id)
              setOpen(false)
            }
          }}
          onClose={() => setOpen(false)}
        />,
        document.body,
      )}
    </>
  )
}

// ── Picker dialog — embeds the full MediaElement ─────────────

interface LibraryMeta { name: string; disk: string; directory: string; accept?: string[]; maxUploadSize?: number; conversions?: unknown[] }

function PickerDialog({ libraries, isMultiple, selectedIds, panelPath, onSelect, onClose }: {
  libraries: LibraryMeta[]
  isMultiple: boolean
  selectedIds: string[]
  panelPath: string
  onSelect: (item: MediaRecord) => void
  onClose: () => void
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [MediaEl, setMediaEl] = useState<React.ComponentType<any> | null>(null)

  // Lazy-load MediaElement to avoid circular imports
  useEffect(() => {
    import('./MediaElement.js').then(m => setMediaEl(() => m.MediaElement)).catch(() => {})
  }, [])

  // Build the element meta that MediaElement expects
  const elementMeta = {
    type: 'media' as const,
    id: 'picker',
    title: 'Select Media',
    libraries: libraries.map(l => ({
      name: l.name,
      disk: l.disk,
      directory: l.directory,
      ...(l.accept ? { accept: l.accept } : {}),
      ...(l.maxUploadSize !== undefined ? { maxUploadSize: l.maxUploadSize } : {}),
      ...(l.conversions ? { conversions: l.conversions } : {}),
    })),
    activeLibrary: libraries[0]?.name ?? 'default',
    scope: 'shared' as const,
    items: [],
    breadcrumbs: [],
    currentFolder: null,
    // Pass picker mode info
    _picker: true,
    _selectedIds: selectedIds,
    _onSelect: onSelect,
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/10 backdrop-blur-xs" onClick={onClose} />
      {/* Content */}
      <div className="fixed top-1/2 left-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-full max-w-3xl max-h-[80vh] rounded-xl bg-background text-sm ring-1 ring-foreground/10 shadow-lg flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 p-4 pb-0 shrink-0">
          <h3 className="text-base font-medium leading-none flex-1">Select Media</h3>
          {isMultiple && (
            <span className="text-xs text-muted-foreground">{selectedIds.length} selected</span>
          )}
          {isMultiple && (
            <button type="button" onClick={onClose} className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors">
              Done
            </button>
          )}
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Embedded media browser */}
        <div className="flex-1 overflow-hidden p-4 pt-2">
          {MediaEl ? (
            <MediaEl
              element={elementMeta}
              panelPath={panelPath}
              i18n={{}}
            />
          ) : (
            <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
              Loading...
            </div>
          )}
        </div>
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
