import { useState, useEffect, useRef, useMemo } from 'react'
import { Dialog } from '@base-ui-components/react/dialog'
import type { FieldMeta } from '@boostkit/panels'
import type { FieldInputProps } from './types.js'
import { INPUT_CLS } from './types.js'
import { CheckIcon } from './Icons.js'
import { FieldInput } from '../FieldInput.js'
import { t } from '../../_lib/formHelpers.js'

function generateSlug(str: string): string {
  return str.toLowerCase().trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

interface Opt { value: string; label: string }

export function BelongsToManyInput({ field, value, onChange, uploadBase = '', i18n, disabled = false }: FieldInputProps) {
  const resourceSlug = field.extra?.['resource'] as string | undefined
  const labelField   = (field.extra?.['displayField'] as string) ?? 'name'
  const creatable    = field.extra?.['creatable'] === true
  const selected     = Array.isArray(value) ? (value as string[]) : []

  const [opts, setOpts]           = useState<Opt[]>([])
  const [loading, setLoading]     = useState(true)
  const [query, setQuery]         = useState('')
  const [open, setOpen]           = useState(false)
  const [focusedIdx, setFocusedIdx] = useState(-1)

  // Create dialog
  const [createOpen, setCreateOpen]       = useState(false)
  const [createSchema, setCreateSchema]   = useState<FieldMeta[]>([])
  const [createValues, setCreateValues]   = useState<Record<string, unknown>>({})
  const [creating, setCreating]           = useState(false)
  const [schemaLoading, setSchemaLoading] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef     = useRef<HTMLInputElement>(null)
  const listRef      = useRef<HTMLDivElement>(null)

  // Load options
  useEffect(() => {
    if (!resourceSlug || !uploadBase) { setLoading(false); return }
    fetch(`${uploadBase}/${resourceSlug}/_options?label=${labelField}`)
      .then(r => r.json())
      .then((data) => { setOpts(data as Opt[]); setLoading(false) })
      .catch(() => setLoading(false))
  }, [resourceSlug, labelField, uploadBase])

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false)
        setFocusedIdx(-1)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Scroll focused item into view
  useEffect(() => {
    if (!open || focusedIdx < 0) return
    const el = listRef.current?.children[focusedIdx] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [focusedIdx, open])

  // Auto-generate slugs inside the create dialog
  const createValuesKey = JSON.stringify(createValues)
  useEffect(() => {
    if (!createOpen || createSchema.length === 0) return
    const slugFields = createSchema.filter(f => f.type === 'slug' && f.extra?.['from'])
    if (slugFields.length === 0) return
    setCreateValues(prev => {
      const next = { ...prev }
      for (const sf of slugFields) {
        const src     = String(sf.extra?.['from'] ?? '')
        const srcVal  = String(prev[src] ?? '')
        const current = String(prev[sf.name] ?? '')
        const auto    = generateSlug(srcVal)
        if (!current || current === generateSlug(current)) next[sf.name] = auto
      }
      return next
    })
  }, [createOpen, createSchema, createValuesKey])

  const filtered = useMemo(() =>
    opts.filter(o => o.label.toLowerCase().includes(query.toLowerCase())),
    [opts, query],
  )

  const exactMatch  = opts.some(o => o.label.toLowerCase() === query.trim().toLowerCase())
  const showCreate  = creatable && query.trim().length > 0 && !exactMatch
  const totalItems  = filtered.length + (showCreate ? 1 : 0)

  function toggle(id: string) {
    const next = selected.includes(id)
      ? selected.filter(s => s !== id)
      : [...selected, id]
    onChange(next)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      setOpen(true)
      setFocusedIdx(0)
      e.preventDefault()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setFocusedIdx(i => (i + 1) % totalItems)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setFocusedIdx(i => (i - 1 + totalItems) % totalItems)
    } else if (e.key === 'Enter' && open) {
      e.preventDefault()
      if (focusedIdx >= 0 && focusedIdx < filtered.length) {
        toggle(filtered[focusedIdx]?.value ?? '')
      } else if (showCreate && focusedIdx === filtered.length) {
        void openCreateDialog()
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
      setFocusedIdx(-1)
      inputRef.current?.blur()
    } else if (e.key === 'Backspace' && !query && selected.length > 0) {
      onChange(selected.slice(0, -1))
    }
  }

  async function openCreateDialog() {
    setOpen(false)
    setCreateOpen(true)
    setSchemaLoading(true)
    try {
      const res  = await fetch(`${uploadBase}/${resourceSlug}/_schema`)
      const data = await res.json() as { resourceMeta: { fields: FieldMeta[] } }
      const fields = data.resourceMeta.fields.filter(f => !f.hidden.includes('create'))
      setCreateSchema(fields)
      const init: Record<string, unknown> = {}
      for (const f of fields) {
        if (f.extra?.['default'] !== undefined) { init[f.name] = f.extra['default']; continue }
        if (f.type === 'boolean' || f.type === 'toggle') { init[f.name] = false; continue }
        if (f.type === 'belongsToMany') { init[f.name] = []; continue }
        if (f.type === 'belongsTo')     { init[f.name] = null; continue }
        init[f.name] = f.type === 'number' ? null : ''
      }
      // Pre-fill the label field with what the user typed
      if (query.trim()) init[labelField] = query.trim()
      setCreateValues(init)
    } catch {
      // fallback: single-field dialog
      setCreateSchema([])
      setCreateValues({ [labelField]: query.trim() })
    } finally {
      setSchemaLoading(false)
    }
  }

  async function handleCreate() {
    if (!resourceSlug || !uploadBase) return
    setCreating(true)
    try {
      const res = await fetch(`${uploadBase}/${resourceSlug}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(createValues),
      })
      if (!res.ok) throw new Error('Create failed')
      const body   = await res.json() as { data: { id: string } & Record<string, unknown> }
      const record = body.data
      const newOpt: Opt = { value: String(record.id), label: String(record[labelField] ?? record.id) }
      setOpts(prev => [...prev, newOpt])
      onChange([...selected, String(record.id)])
      setCreateOpen(false)
      setQuery('')
    } catch {
      // failed — leave state unchanged
    } finally {
      setCreating(false)
    }
  }

  return (
    <div ref={containerRef} className="flex flex-col gap-2 relative">
      {/* Chips + search input */}
      <div
        className="flex flex-wrap gap-1.5 p-1.5 min-h-[42px] rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring cursor-text"
        onClick={() => inputRef.current?.focus()}
      >
        {selected.map((id) => {
          const opt = opts.find(o => o.value === id)
          return (
            <span
              key={id}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium"
            >
              {opt?.label ?? id}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onChange(selected.filter(s => s !== id)) }}
                className="hover:text-destructive leading-none ml-0.5 cursor-pointer"
              >×</button>
            </span>
          )
        })}
        <input
          ref={inputRef}
          type="text"
          value={query}
          placeholder={loading ? i18n.loading : selected.length > 0 ? i18n.addMore : t(i18n.search, { label: field.label })}
          disabled={loading || field.readonly || disabled}
          className="flex-1 min-w-[120px] px-1 py-1 text-sm bg-transparent outline-none"
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setFocusedIdx(-1) }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
        />
      </div>

      {/* Dropdown */}
      {open && totalItems > 0 && (
        <div
          ref={listRef}
          className="absolute top-full left-0 right-0 z-50 mt-1 max-h-60 overflow-y-auto rounded-md border border-border bg-popover shadow-lg py-1"
        >
          {filtered.map((o, i) => {
            const isSelected = selected.includes(o.value)
            const isFocused  = i === focusedIdx
            return (
              <div
                key={o.value}
                onMouseDown={(e) => { e.preventDefault(); toggle(o.value) }}
                onMouseEnter={() => setFocusedIdx(i)}
                className={[
                  'flex items-center gap-2 px-3 py-2 text-sm cursor-pointer select-none',
                  isFocused ? 'bg-accent text-accent-foreground' : 'hover:bg-accent hover:text-accent-foreground',
                ].join(' ')}
              >
                <span className={['w-4 shrink-0 text-primary', isSelected ? 'opacity-100' : 'opacity-0'].join(' ')}>
                  <CheckIcon />
                </span>
                <span>{o.label}</span>
              </div>
            )
          })}

          {showCreate && (
            <div
              onMouseDown={(e) => { e.preventDefault(); void openCreateDialog() }}
              onMouseEnter={() => setFocusedIdx(filtered.length)}
              className={[
                'flex items-center gap-2 px-3 py-2 text-sm cursor-pointer select-none text-primary border-t border-border mt-1 pt-2',
                focusedIdx === filtered.length ? 'bg-accent text-accent-foreground' : 'hover:bg-accent hover:text-accent-foreground',
              ].join(' ')}
            >
              <span className="font-bold w-4 shrink-0">+</span>
              <span>{t(i18n.createOption, { query: query.trim() })}</span>
            </div>
          )}
        </div>
      )}

      {/* Create dialog — full resource schema */}
      <Dialog.Root open={createOpen} onOpenChange={setCreateOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 bg-black/40 z-50" />
          <Dialog.Popup className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-lg rounded-lg border border-border bg-popover shadow-xl flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
              <Dialog.Title className="text-base font-semibold">
                {t(i18n.createNew, { singular: (field.extra?.['labelSingular'] as string) ?? field.label })}
              </Dialog.Title>
              <Dialog.Close className="text-muted-foreground hover:text-foreground text-lg leading-none">×</Dialog.Close>
            </div>

            <div className="flex flex-col gap-4 p-6 overflow-y-auto">
              {schemaLoading && <p className="text-sm text-muted-foreground">{i18n.loadingForm}</p>}

              {!schemaLoading && createSchema.length > 0 && createSchema.map((f) => (
                <div key={f.name}>
                  {f.type !== 'boolean' && f.type !== 'toggle' && f.type !== 'hidden' && (
                    <label className="block text-sm font-medium mb-1.5">
                      {f.label}
                      {f.required && <span className="text-destructive ml-0.5">*</span>}
                    </label>
                  )}
                  <FieldInput
                    field={f}
                    value={createValues[f.name]}
                    onChange={(v) => setCreateValues(prev => ({ ...prev, [f.name]: v }))}
                    uploadBase={uploadBase}
                    i18n={i18n}
                  />
                </div>
              ))}

              {/* Fallback: single field when schema couldn't load */}
              {!schemaLoading && createSchema.length === 0 && (
                <div>
                  <label className="block text-sm font-medium mb-1.5 capitalize">{labelField}</label>
                  <input
                    type="text"
                    value={String(createValues[labelField] ?? '')}
                    onChange={(e) => setCreateValues(prev => ({ ...prev, [labelField]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleCreate() } }}
                    className={INPUT_CLS}
                    autoFocus
                  />
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 px-6 py-4 border-t border-border shrink-0">
              <Dialog.Close className="px-4 py-2 rounded-md text-sm border border-input hover:bg-accent transition-colors">
                {i18n.cancel}
              </Dialog.Close>
              <button
                type="button"
                onClick={() => void handleCreate()}
                disabled={creating}
                className="px-4 py-2 rounded-md text-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {creating ? i18n.creating : i18n.create.replace(/:singular/g, '')}
              </button>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}
