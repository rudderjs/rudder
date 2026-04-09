import { useState, useRef, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import type { FieldMeta, PanelI18n } from '@pilotiq/panels'
import { CellValue, resolveCellValue } from './CellValue.js'

interface Props {
  record:       Record<string, unknown>
  field:        FieldMeta
  slug:         string
  pathSegment:  string
  i18n:         PanelI18n
}

export function InlineEditCell({ record, field, slug, pathSegment, i18n }: Props) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [localValue, setLocalValue] = useState<unknown>(record[field.name])
  const id = record['id'] as string

  // Sync localValue when record changes (e.g. after live reload)
  useEffect(() => { setLocalValue(record[field.name]) }, [record, field.name])

  const save = useCallback(async (newValue: unknown) => {
    if (newValue === record[field.name]) {
      setEditing(false)
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/${pathSegment}/api/${slug}/${id}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ [field.name]: newValue }),
      })
      if (res.ok) {
        setLocalValue(newValue)
        // Update the record in-place so CellValue re-renders
        record[field.name] = newValue
      } else {
        toast.error((i18n as PanelI18n & Record<string, string>)['saveError'] ?? 'Save failed.')
      }
    } catch {
      toast.error((i18n as PanelI18n & Record<string, string>)['saveError'] ?? 'Save failed.')
    } finally {
      setSaving(false)
      setEditing(false)
    }
  }, [record, field.name, pathSegment, slug, id, i18n])

  // Toggle — no edit mode needed, just click to flip
  if (field.type === 'boolean' || field.type === 'toggle') {
    return (
      <button
        type="button"
        disabled={saving}
        onClick={() => void save(!localValue)}
        className="group inline-flex items-center gap-2 disabled:opacity-50"
      >
        <span
          className={[
            'relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors',
            localValue ? 'bg-primary' : 'bg-muted',
          ].join(' ')}
        >
          <span
            className={[
              'pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-sm transition-transform',
              localValue ? 'translate-x-4' : 'translate-x-0',
            ].join(' ')}
          />
        </span>
      </button>
    )
  }

  // Select — dropdown
  if (editing && field.type === 'select') {
    const options = (field.extra?.['options'] ?? []) as { label: string; value: string | number | boolean }[]
    return (
      <SelectEditor
        value={localValue}
        options={options}
        onSave={save}
        onCancel={() => setEditing(false)}
      />
    )
  }

  // Text / Number — inline input
  if (editing && (field.type === 'text' || field.type === 'email' || field.type === 'number')) {
    return (
      <TextEditor
        value={localValue}
        type={field.type === 'number' ? 'number' : 'text'}
        onSave={save}
        onCancel={() => setEditing(false)}
      />
    )
  }

  // Display mode — click to edit
  return (
    <span
      onClick={() => setEditing(true)}
      className={[
        'cursor-pointer rounded px-1 -mx-1 transition-colors',
        'hover:bg-accent/60',
        saving ? 'opacity-50' : '',
      ].join(' ')}
      title="Click to edit"
    >
      <CellValue
        value={resolveCellValue(record, field)}
        type={field.type}
        extra={field.extra}
        displayTransformed={field.displayTransformed}
        pathSegment={pathSegment}
        i18n={i18n}
      />
    </span>
  )
}

// ── Text/Number inline editor ─────────────────────────────

function TextEditor({ value, type, onSave, onCancel }: {
  value:    unknown
  type:     'text' | 'number'
  onSave:   (v: unknown) => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      const val = ref.current?.value ?? ''
      onSave(type === 'number' ? (val === '' ? null : Number(val)) : val)
    }
    if (e.key === 'Escape') {
      onCancel()
    }
  }

  return (
    <input
      ref={ref}
      type={type}
      defaultValue={value != null ? String(value) : ''}
      onBlur={() => {
        const val = ref.current?.value ?? ''
        onSave(type === 'number' ? (val === '' ? null : Number(val)) : val)
      }}
      onKeyDown={handleKeyDown}
      className="w-full px-2 py-1 text-sm border border-primary rounded bg-background outline-none focus:ring-2 focus:ring-primary/30"
    />
  )
}

// ── Select inline editor ──────────────────────────────────

function SelectEditor({ value, options, onSave, onCancel }: {
  value:    unknown
  options:  { label: string; value: string | number | boolean }[]
  onSave:   (v: unknown) => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLSelectElement>(null)

  useEffect(() => {
    ref.current?.focus()
  }, [])

  return (
    <select
      ref={ref}
      defaultValue={String(value ?? '')}
      onChange={(e) => onSave(e.target.value)}
      onBlur={onCancel}
      onKeyDown={(e) => { if (e.key === 'Escape') onCancel() }}
      className="w-full px-2 py-1 text-sm border border-primary rounded bg-background outline-none focus:ring-2 focus:ring-primary/30"
    >
      {options.map((opt) => (
        <option key={String(opt.value)} value={String(opt.value)}>
          {opt.label}
        </option>
      ))}
    </select>
  )
}
