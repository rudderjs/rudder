'use client'

import { useState } from 'react'
import type { PanelI18n } from '@boostkit/panels'
import type { WidgetMeta, WidgetSettingsField } from '@boostkit/panels'

interface Props {
  widget:          WidgetMeta
  currentSettings: Record<string, unknown>
  onSave:          (settings: Record<string, unknown>) => void
  onClose:         () => void
  i18n:            PanelI18n & Record<string, string>
}

export function WidgetSettingsDrawer({ widget, currentSettings, onSave, onClose, i18n }: Props) {
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    // Initialize with current settings, falling back to field defaults
    const init: Record<string, unknown> = {}
    for (const field of widget.settings ?? []) {
      init[field.name] = currentSettings[field.name] ?? field.default ?? ''
    }
    return init
  })

  function handleSave() {
    onSave(values)
    onClose()
  }

  if (!widget.settings || widget.settings.length === 0) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed top-0 right-0 h-full w-80 bg-background border-l z-50 flex flex-col shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div>
            <p className="text-sm font-semibold">{widget.label}</p>
            <p className="text-xs text-muted-foreground">{i18n.widgetSettings ?? 'Settings'}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-accent transition-colors text-muted-foreground"
          >
            {'\u00d7'}
          </button>
        </div>

        {/* Fields */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
          {widget.settings.map(field => (
            <SettingsField
              key={field.name}
              field={field}
              value={values[field.name]}
              onChange={(v) => setValues(prev => ({ ...prev, [field.name]: v }))}
            />
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t flex items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            className="px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
          >
            {i18n.widgetSettingsSave ?? 'Save'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {i18n.cancel ?? 'Cancel'}
          </button>
        </div>
      </div>
    </>
  )
}

// -- Individual settings field renderer ----------------------------------------

function SettingsField({ field, value, onChange }: {
  field:    WidgetSettingsField
  value:    unknown
  onChange: (v: unknown) => void
}) {
  const label = field.label ?? field.name

  if (field.type === 'select') {
    const options = (field.options ?? []).map(opt =>
      typeof opt === 'string' ? { label: opt, value: opt } : opt
    )
    return (
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <select
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-2 text-sm rounded-md border bg-background"
        >
          {options.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </label>
    )
  }

  if (field.type === 'toggle') {
    return (
      <label className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <button
          type="button"
          onClick={() => onChange(!value)}
          className={`w-9 h-5 rounded-full transition-colors ${value ? 'bg-primary' : 'bg-muted'}`}
        >
          <span className={`block w-4 h-4 rounded-full bg-white shadow transition-transform ${value ? 'translate-x-4' : 'translate-x-0.5'}`} />
        </button>
      </label>
    )
  }

  if (field.type === 'number') {
    return (
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <input
          type="number"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value ? Number(e.target.value) : '')}
          className="w-full px-3 py-2 text-sm rounded-md border bg-background"
        />
      </label>
    )
  }

  // Default: text input
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <input
        type="text"
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 text-sm rounded-md border bg-background"
      />
    </label>
  )
}
