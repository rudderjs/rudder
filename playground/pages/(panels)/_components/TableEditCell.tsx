'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import type { FieldMeta, PanelI18n, PanelColumnMeta } from '@boostkit/panels'
import { TableEditPopover } from './TableEditPopover.js'
import { TableEditModal } from './TableEditModal.js'
import { formatCellValue } from './formatCellValue.js'

interface TableEditCellProps {
  record: Record<string, unknown>
  column: PanelColumnMeta
  saveEndpoint: string
  panelPath: string
  i18n: PanelI18n
  onSaved?: (record: Record<string, unknown>, field: string, value: unknown) => void
}

export function TableEditCell({ record, column, saveEndpoint, panelPath, i18n, onSaved }: TableEditCellProps) {
  const editField = column.editField!
  const editMode = column.editMode ?? 'inline'
  const [saving, setSaving] = useState(false)
  const [localValue, setLocalValue] = useState<unknown>(record[column.name])

  // Sync when record prop changes (e.g. after live reload)
  useEffect(() => { setLocalValue(record[column.name]) }, [record, column.name])

  const save = useCallback(async (newValue: unknown) => {
    if (newValue === record[column.name]) return
    setSaving(true)
    try {
      const res = await fetch(saveEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordId: record['id'], field: column.name, value: newValue }),
      })
      if (res.ok) {
        setLocalValue(newValue)
        onSaved?.(record, column.name, newValue)
      } else {
        const body = await res.json().catch(() => ({})) as { message?: string }
        toast.error(body.message ?? 'Save failed.')
      }
    } catch {
      toast.error('Save failed.')
    } finally {
      setSaving(false)
    }
  }, [record, column.name, saveEndpoint, onSaved])

  // ── Toggle / Boolean: direct click, no edit mode ──
  if (editField.type === 'boolean' || editField.type === 'toggle') {
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

  // ── Popover mode ──
  if (editMode === 'popover') {
    return (
      <TableEditPopover
        value={localValue}
        editField={editField}
        column={column}
        saving={saving}
        panelPath={panelPath}
        i18n={i18n}
        onSave={save}
      />
    )
  }

  // ── Modal mode ──
  if (editMode === 'modal') {
    return (
      <TableEditModal
        value={localValue}
        editField={editField}
        column={column}
        saving={saving}
        panelPath={panelPath}
        i18n={i18n}
        onSave={save}
      />
    )
  }

  // ── Inline mode (default) ──
  return (
    <InlineEditor
      value={localValue}
      editField={editField}
      column={column}
      saving={saving}
      panelPath={panelPath}
      i18n={i18n}
      onSave={save}
    />
  )
}

// ─── Inline editing sub-component ─────────────────────────────

function InlineEditor({ value, editField, column, saving, panelPath, i18n, onSave }: {
  value: unknown
  editField: FieldMeta
  column: PanelColumnMeta
  saving: boolean
  panelPath: string
  i18n: PanelI18n
  onSave: (v: unknown) => void
}) {
  const [editing, setEditing] = useState(false)

  if (editing && editField.type === 'select') {
    const options = (editField.extra?.['options'] ?? []) as { label: string; value: string | number | boolean }[]
    return (
      <InlineSelect
        value={value}
        options={options}
        onSave={(v) => { void onSave(v); setEditing(false) }}
        onCancel={() => setEditing(false)}
      />
    )
  }

  if (editing && (editField.type === 'text' || editField.type === 'email' || editField.type === 'number' || editField.type === 'date' || editField.type === 'datetime' || editField.type === 'color')) {
    const inputType = editField.type === 'number' ? 'number'
      : editField.type === 'date' ? 'date'
      : editField.type === 'datetime' ? 'datetime-local'
      : editField.type === 'color' ? 'color'
      : 'text'
    return (
      <InlineText
        value={value}
        type={inputType}
        onSave={(v) => { void onSave(v); setEditing(false) }}
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
      {formatCellValue(value, column, i18n, panelPath)}
    </span>
  )
}

// ─── Inline text/number/date input ────────────────────────────

function InlineText({ value, type, onSave, onCancel }: {
  value: unknown
  type: string
  onSave: (v: unknown) => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    ref.current?.focus()
    if (type === 'text') ref.current?.select()
  }, [])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      commitValue()
    }
    if (e.key === 'Escape') {
      onCancel()
    }
  }

  function commitValue() {
    const val = ref.current?.value ?? ''
    if (type === 'number') {
      onSave(val === '' ? null : Number(val))
    } else if (type === 'date' || type === 'datetime-local') {
      onSave(val || null)
    } else {
      onSave(val)
    }
  }

  return (
    <input
      ref={ref}
      type={type}
      defaultValue={value != null ? String(value) : ''}
      onBlur={commitValue}
      onKeyDown={handleKeyDown}
      className="w-full px-2 py-1 text-sm border border-primary rounded bg-background outline-none focus:ring-2 focus:ring-primary/30"
    />
  )
}

// ─── Inline select ────────────────────────────────────────────

function InlineSelect({ value, options, onSave, onCancel }: {
  value: unknown
  options: { label: string; value: string | number | boolean }[]
  onSave: (v: unknown) => void
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
