'use client'

import { useState, useRef, useEffect } from 'react'
import type { FieldMeta, PanelI18n, PanelColumnMeta } from '@rudderjs/panels'
import { FieldInput } from './FieldInput.js'
import { formatCellValue } from './formatCellValue.js'

interface TableEditPopoverProps {
  value: unknown
  editField: FieldMeta
  column: PanelColumnMeta
  saving: boolean
  panelPath: string
  i18n: PanelI18n
  onSave: (v: unknown) => void
}

export function TableEditPopover({ value, editField, column, saving, panelPath, i18n, onSave }: TableEditPopoverProps) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<unknown>(value)
  const triggerRef = useRef<HTMLSpanElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Sync draft with external value
  useEffect(() => { setDraft(value) }, [value])

  // Close on click outside
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open])

  function handleSave() {
    void onSave(draft)
    setOpen(false)
  }

  const pathSegment = panelPath.replace(/^\//, '')

  return (
    <span className="relative inline-block">
      {/* Trigger — cell value */}
      <span
        ref={triggerRef}
        onClick={() => { setDraft(value); setOpen(true) }}
        className={[
          'cursor-pointer rounded px-1 -mx-1 transition-colors',
          'hover:bg-accent/60',
          saving ? 'opacity-50' : '',
        ].join(' ')}
        title="Click to edit"
      >
        {formatCellValue(value, column, i18n, panelPath)}
      </span>

      {/* Popover */}
      {open && (
        <div
          ref={popoverRef}
          className="absolute left-0 top-full mt-1 z-50 min-w-[16rem] rounded-lg border bg-background shadow-lg p-3"
        >
          <div className="mb-2">
            <FieldInput
              field={editField}
              value={draft}
              onChange={setDraft}
              uploadBase={`/${pathSegment}/api`}
              i18n={i18n}
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="px-2.5 py-1 text-xs rounded border text-muted-foreground hover:bg-accent transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-2.5 py-1 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </span>
  )
}
