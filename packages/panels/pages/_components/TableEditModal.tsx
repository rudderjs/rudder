'use client'

import { useState, useEffect } from 'react'
import type { FieldMeta, PanelI18n, PanelColumnMeta } from '@rudderjs/panels'
import { FieldInput } from './FieldInput.js'
import { formatCellValue } from './formatCellValue.js'

interface TableEditModalProps {
  value: unknown
  editField: FieldMeta
  column: PanelColumnMeta
  saving: boolean
  panelPath: string
  i18n: PanelI18n
  onSave: (v: unknown) => void
}

export function TableEditModal({ value, editField, column, saving, panelPath, i18n, onSave }: TableEditModalProps) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<unknown>(value)

  // Sync draft with external value
  useEffect(() => { setDraft(value) }, [value])

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
    <>
      {/* Trigger — cell value */}
      <span
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

      {/* Modal dialog */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          role="dialog"
          aria-modal="true"
          aria-label={`Edit ${column.label}`}
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setOpen(false)}
          />

          {/* Panel */}
          <div className="relative z-10 w-full max-w-md mx-4 rounded-xl border bg-background shadow-lg">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="text-base font-semibold leading-none">
                Edit {column.label}
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Close"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Content */}
            <div className="px-6 py-4">
              <FieldInput
                field={editField}
                value={draft}
                onChange={setDraft}
                uploadBase={`/${pathSegment}/api`}
                i18n={i18n}
              />
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 px-6 py-4 border-t">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="px-4 py-2 text-sm rounded-md border text-muted-foreground hover:bg-accent transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
