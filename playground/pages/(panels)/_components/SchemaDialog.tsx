'use client'

import { useState } from 'react'
import type { SchemaDialogMeta, PanelI18n, PanelSchemaElementMeta } from '@boostkit/panels'
import type { FormElementMeta } from '@boostkit/panels'
import { SchemaForm } from './SchemaForm.js'
import { SchemaElementRenderer } from './SchemaElementRenderer.js'

interface SchemaDialogProps {
  dialog:     SchemaDialogMeta
  panelPath:  string
  pathSegment: string
  i18n:       PanelI18n
}

export function SchemaDialog({ dialog, panelPath, i18n }: SchemaDialogProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {dialog.trigger}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          role="dialog"
          aria-modal="true"
          aria-label={dialog.title ?? dialog.trigger}
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setOpen(false)}
          />

          {/* Panel */}
          <div className="relative z-10 w-full max-w-lg mx-4 rounded-xl border bg-background shadow-lg">
            {/* Header */}
            <div className="flex items-start justify-between px-6 py-4 border-b">
              <div>
                <h2 className="text-base font-semibold leading-none">
                  {dialog.title ?? dialog.trigger}
                </h2>
                {dialog.description && (
                  <p className="text-sm text-muted-foreground mt-1">{dialog.description}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="ml-4 text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Close"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Content */}
            <div className="px-6 py-4 flex flex-col gap-4 max-h-[70vh] overflow-y-auto">
              {(dialog.elements as PanelSchemaElementMeta[]).map((el, i: number) => {
                if (el.type === 'form') {
                  return (
                    <SchemaForm
                      key={`df-${(el as FormElementMeta).id ?? i}`}
                      form={el as FormElementMeta}
                      panelPath={panelPath}
                      i18n={i18n}
                    />
                  )
                }
                return (
                  <SchemaElementRenderer key={i} element={el} panelPath={panelPath} i18n={i18n} />
                )
              })}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
