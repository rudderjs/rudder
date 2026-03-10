import { useState, useEffect, useRef } from 'react'
import { Checkbox } from '@base-ui-components/react/checkbox'
import { Combobox } from '@base-ui-components/react/combobox'
import { Dialog } from '@base-ui-components/react/dialog'
import { Select } from '@base-ui-components/react/select'
import { Switch } from '@base-ui-components/react/switch'
import type { FieldMeta } from '@boostkit/panels'
import { customFieldRenderers } from './CustomFieldRenderers.js'

interface Props {
  field:       FieldMeta
  value:       unknown
  onChange:    (value: unknown) => void
  /** API base URL for the active panel (e.g. '/admin/api'). Required for FileField / ImageField. */
  uploadBase?: string
}

export function FieldInput({ field, value, onChange, uploadBase = '' }: Props) {
  const inputCls = 'w-full rounded-md border border-input px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent disabled:bg-muted disabled:text-muted-foreground'

  // ── Boolean ─────────────────────────────────────────────
  if (field.type === 'boolean') {
    return (
      <div className="flex items-center gap-3">
        <Checkbox.Root
          checked={!!value}
          onCheckedChange={(checked) => onChange(checked)}
          className="h-5 w-5 rounded border-2 border-input bg-background flex items-center justify-center transition-colors data-[checked]:bg-primary data-[checked]:border-primary focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 cursor-pointer"
        >
          <Checkbox.Indicator className="text-primary-foreground">
            <CheckIcon />
          </Checkbox.Indicator>
        </Checkbox.Root>
        <span className="text-sm">{field.label}</span>
      </div>
    )
  }

  // ── Select ───────────────────────────────────────────────
  if (field.type === 'select') {
    const options = (field.extra?.options ?? []) as Array<{ label: string; value: string } | string>
    const normalised = options.map((o) =>
      typeof o === 'string' ? { label: o, value: o } : o,
    )
    return (
      <Select.Root
        value={value as string}
        onValueChange={(v) => onChange(v)}
        name={field.name}
      >
        <Select.Trigger className={`${inputCls} flex items-center justify-between`}>
          <Select.Value>{(value as string) || `Select ${field.label}…`}</Select.Value>
          <Select.Icon className="text-muted-foreground">
            <ChevronIcon />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Positioner>
            <Select.Popup className="z-50 min-w-[180px] rounded-md border border-border bg-popover shadow-lg py-1 outline-none">
              {normalised.map((opt) => (
                <Select.Item
                  key={opt.value}
                  value={opt.value}
                  className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground outline-none"
                >
                  <Select.ItemIndicator className="text-primary">
                    <CheckIcon />
                  </Select.ItemIndicator>
                  <Select.ItemText>{opt.label}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.Popup>
          </Select.Positioner>
        </Select.Portal>
      </Select.Root>
    )
  }

  // ── Textarea ─────────────────────────────────────────────
  if (field.type === 'textarea') {
    return (
      <textarea
        name={field.name}
        value={(value as string) ?? ''}
        onChange={(e) => onChange(e.target.value)}
        rows={(field.extra?.rows as number) ?? 4}
        required={field.required}
        readOnly={field.readonly}
        className={inputCls}
      />
    )
  }

  // ── Password ─────────────────────────────────────────────
  if (field.type === 'password') {
    return (
      <div className="flex flex-col gap-2">
        <input
          type="password"
          name={field.name}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          required={field.required}
          placeholder="••••••••"
          autoComplete="new-password"
          className={inputCls}
        />
        {field.extra?.confirm && (
          <input
            type="password"
            name={`${field.name}_confirmation`}
            placeholder="Confirm password"
            autoComplete="new-password"
            className={inputCls}
          />
        )}
      </div>
    )
  }

  // ── Slug ─────────────────────────────────────────────────
  if (field.type === 'slug') {
    return (
      <div className="flex items-center rounded-md border border-input bg-muted overflow-hidden focus-within:ring-2 focus-within:ring-ring focus-within:border-transparent">
        <span className="px-3 text-sm text-muted-foreground select-none border-r border-input bg-muted">/</span>
        <input
          type="text"
          name={field.name}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          required={field.required}
          readOnly={field.readonly}
          placeholder="my-slug"
          className="flex-1 px-3 py-2 text-sm bg-background focus:outline-none"
        />
      </div>
    )
  }

  // ── Tags ─────────────────────────────────────────────────
  if (field.type === 'tags') {
    const tags = Array.isArray(value) ? (value as string[]) : (typeof value === 'string' && value ? (() => { try { return JSON.parse(value) } catch { return value.split(',') } })() : [])

    function addTag(input: HTMLInputElement) {
      const tag = input.value.trim().replace(/,+$/, '')
      if (!tag || tags.includes(tag)) { input.value = ''; return }
      onChange([...tags, tag])
      input.value = ''
    }

    return (
      <div className="flex flex-wrap gap-1.5 p-2 rounded-md border border-input bg-background min-h-[42px] focus-within:ring-2 focus-within:ring-ring">
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium"
          >
            {tag}
            <button
              type="button"
              onClick={() => onChange(tags.filter((t) => t !== tag))}
              className="hover:text-destructive leading-none"
            >
              ×
            </button>
          </span>
        ))}
        <input
          type="text"
          placeholder={(field.extra?.placeholder as string) ?? 'Add tag…'}
          className="flex-1 min-w-[80px] text-sm outline-none bg-transparent"
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault()
              addTag(e.currentTarget)
            }
            if (e.key === 'Backspace' && !e.currentTarget.value && tags.length > 0) {
              onChange(tags.slice(0, -1))
            }
          }}
          onBlur={(e) => addTag(e.currentTarget)}
        />
      </div>
    )
  }

  // ── Hidden ───────────────────────────────────────────────
  if (field.type === 'hidden') {
    return (
      <input
        type="hidden"
        name={field.name}
        value={String((value ?? field.extra?.default) ?? '')}
      />
    )
  }

  // ── Toggle (Switch) ──────────────────────────────────────
  if (field.type === 'toggle') {
    const checked  = !!value
    const onLabel  = (field.extra?.onLabel  as string) ?? 'On'
    const offLabel = (field.extra?.offLabel as string) ?? 'Off'
    return (
      <div className="flex items-center gap-3">
        <Switch.Root
          checked={checked}
          onCheckedChange={(c) => onChange(c)}
          className={[
            'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent',
            'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            checked ? 'bg-primary' : 'bg-muted',
          ].join(' ')}
        >
          <Switch.Thumb
            className={[
              'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm ring-0 transition-transform',
              checked ? 'translate-x-5' : 'translate-x-0',
            ].join(' ')}
          />
        </Switch.Root>
        <span className="text-sm text-muted-foreground">
          {checked ? onLabel : offLabel}
        </span>
      </div>
    )
  }

  // ── Color ────────────────────────────────────────────────
  if (field.type === 'color') {
    return (
      <div className="flex items-center gap-3">
        <input
          type="color"
          name={field.name}
          value={(value as string) ?? '#000000'}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-14 cursor-pointer rounded border border-input bg-background p-0.5"
        />
        <span className="text-sm text-muted-foreground font-mono">
          {(value as string) ?? '#000000'}
        </span>
      </div>
    )
  }

  // ── JSON ─────────────────────────────────────────────────
  if (field.type === 'json') {
    const [jsonError, setJsonError] = useState<string | null>(null)
    const rawValue = typeof value === 'string'
      ? value
      : JSON.stringify(value ?? {}, null, 2)

    return (
      <div className="flex flex-col gap-1">
        <textarea
          name={field.name}
          defaultValue={rawValue}
          rows={(field.extra?.rows as number) ?? 6}
          spellCheck={false}
          className={[inputCls, 'font-mono text-xs', jsonError ? 'border-destructive' : ''].join(' ')}
          onChange={(e) => {
            try {
              JSON.parse(e.target.value)
              setJsonError(null)
              onChange(e.target.value)
            } catch {
              setJsonError('Invalid JSON')
            }
          }}
        />
        {jsonError && <p className="text-xs text-destructive">{jsonError}</p>}
      </div>
    )
  }

  // ── Repeater ─────────────────────────────────────────────
  if (field.type === 'repeater') {
    const schema   = (field.extra?.schema ?? []) as FieldMeta[]
    const addLabel = (field.extra?.addLabel as string) ?? 'Add item'
    const maxItems = field.extra?.maxItems as number | undefined
    const items    = Array.isArray(value) ? (value as Record<string, unknown>[]) : []

    function updateItem(index: number, fieldName: string, fieldValue: unknown) {
      const next = items.map((item, i) =>
        i === index ? { ...item, [fieldName]: fieldValue } : item,
      )
      onChange(next)
    }

    function addItem() {
      if (maxItems !== undefined && items.length >= maxItems) return
      const empty: Record<string, unknown> = {}
      for (const f of schema) empty[f.name] = undefined
      onChange([...items, empty])
    }

    function removeItem(index: number) {
      onChange(items.filter((_, i) => i !== index))
    }

    return (
      <div className="flex flex-col gap-3">
        {items.map((item, index) => (
          <div key={index} className="rounded-lg border border-input bg-card p-4 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Item {index + 1}
              </span>
              <button
                type="button"
                onClick={() => removeItem(index)}
                className="text-xs text-destructive hover:underline"
              >
                Remove
              </button>
            </div>

            {schema.map((subField) => (
              <div key={subField.name} className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">
                  {subField.label}
                  {subField.required && <span className="text-destructive ml-0.5">*</span>}
                </label>
                <FieldInput
                  field={subField}
                  value={item[subField.name]}
                  onChange={(v) => updateItem(index, subField.name, v)}
                  uploadBase={uploadBase}
                />
              </div>
            ))}
          </div>
        ))}

        {(maxItems === undefined || items.length < maxItems) && (
          <button
            type="button"
            onClick={addItem}
            className="flex items-center gap-2 px-4 py-2 rounded-md border border-dashed border-input text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors w-full justify-center"
          >
            <span className="text-base leading-none">+</span>
            {addLabel}
          </button>
        )}
      </div>
    )
  }

  // ── Builder ──────────────────────────────────────────────
  if (field.type === 'builder') {
    const blockDefs = (field.extra?.blocks ?? []) as Array<{
      name: string; label: string; icon?: string; schema: FieldMeta[]
    }>
    const addLabel  = (field.extra?.addLabel as string) ?? 'Add block'
    const maxItems  = field.extra?.maxItems as number | undefined
    const items     = Array.isArray(value)
      ? (value as Array<{ _type: string } & Record<string, unknown>>)
      : []
    const [pickerOpen, setPickerOpen] = useState(false)

    function addBlock(blockName: string) {
      const def   = blockDefs.find((b) => b.name === blockName)
      if (!def) return
      const empty: Record<string, unknown> = { _type: blockName }
      for (const f of def.schema) empty[f.name] = undefined
      onChange([...items, empty])
      setPickerOpen(false)
    }

    function updateBlock(index: number, fieldName: string, fieldValue: unknown) {
      const next = items.map((item, i) =>
        i === index ? { ...item, [fieldName]: fieldValue } : item,
      )
      onChange(next)
    }

    function removeBlock(index: number) {
      onChange(items.filter((_, i) => i !== index))
    }

    function moveBlock(index: number, direction: -1 | 1) {
      const next  = [...items]
      const other = index + direction
      if (other < 0 || other >= next.length) return
      ;[next[index], next[other]] = [next[other]!, next[index]!]
      onChange(next)
    }

    const atMax = maxItems !== undefined && items.length >= maxItems

    return (
      <div className="flex flex-col gap-3">
        {items.map((item, index) => {
          const def = blockDefs.find((b) => b.name === item._type)
          return (
            <div key={index} className="rounded-lg border border-input bg-card overflow-hidden">
              {/* Block header */}
              <div className="flex items-center justify-between px-4 py-2 bg-muted/50 border-b border-input">
                <span className="flex items-center gap-2 text-xs font-medium">
                  {def?.icon && <span>{def.icon}</span>}
                  <span className="text-muted-foreground uppercase tracking-wide">
                    {def?.label ?? item._type}
                  </span>
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => moveBlock(index, -1)}
                    disabled={index === 0}
                    className="px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-30"
                    title="Move up"
                  >↑</button>
                  <button
                    type="button"
                    onClick={() => moveBlock(index, 1)}
                    disabled={index === items.length - 1}
                    className="px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-30"
                    title="Move down"
                  >↓</button>
                  <button
                    type="button"
                    onClick={() => removeBlock(index)}
                    className="px-1.5 py-0.5 text-xs text-destructive hover:underline ml-1"
                  >Remove</button>
                </div>
              </div>

              {/* Block fields */}
              <div className="p-4 flex flex-col gap-4">
                {(def?.schema ?? []).map((subField) => (
                  <div key={subField.name} className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium">
                      {subField.label}
                      {subField.required && <span className="text-destructive ml-0.5">*</span>}
                    </label>
                    <FieldInput
                      field={subField}
                      value={item[subField.name]}
                      onChange={(v) => updateBlock(index, subField.name, v)}
                      uploadBase={uploadBase}
                    />
                  </div>
                ))}
              </div>
            </div>
          )
        })}

        {/* Block picker */}
        {!atMax && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setPickerOpen((o) => !o)}
              className="flex items-center gap-2 px-4 py-2 rounded-md border border-dashed border-input text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors w-full justify-center"
            >
              <span className="text-base leading-none">+</span>
              {addLabel}
            </button>

            {pickerOpen && (
              <div className="absolute bottom-full mb-2 left-0 z-20 w-full rounded-lg border border-border bg-popover shadow-lg py-1 overflow-hidden">
                {blockDefs.map((def) => (
                  <button
                    key={def.name}
                    type="button"
                    onClick={() => addBlock(def.name)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-accent hover:text-accent-foreground transition-colors text-left"
                  >
                    {def.icon && <span className="text-base shrink-0">{def.icon}</span>}
                    <div>
                      <p className="font-medium">{def.label}</p>
                      <p className="text-xs text-muted-foreground">{def.schema.length} field{def.schema.length !== 1 ? 's' : ''}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  // ── File / Image ─────────────────────────────────────────
  if (field.type === 'file' || field.type === 'image') {
    const multiple  = !!(field.extra?.multiple)
    const accept    = (field.extra?.accept    as string) || undefined
    const disk      = (field.extra?.disk      as string) ?? 'local'
    const directory = (field.extra?.directory as string) ?? 'uploads'
    const urls      = multiple ? (Array.isArray(value) ? (value as string[]) : []) : []
    const singleUrl = !multiple ? (value as string | undefined) : undefined
    const [uploading, setUploading] = useState(false)

    async function handleFiles(files: FileList | null) {
      if (!files?.length) return
      setUploading(true)
      try {
        const results: string[] = []
        for (const f of Array.from(files)) {
          const fd = new FormData()
          fd.append('file', f)
          fd.append('disk', disk)
          fd.append('directory', directory)
          const res = await fetch(`${uploadBase}/_upload`, { method: 'POST', body: fd })
          const { url } = await res.json() as { url: string }
          results.push(url)
        }
        onChange(multiple ? [...urls, ...results] : results[0])
      } catch {
        // upload failed — leave value unchanged
      } finally {
        setUploading(false)
      }
    }

    return (
      <div className="flex flex-col gap-2">
        {field.type === 'image' && singleUrl && (
          <img src={singleUrl} alt="" className="max-h-32 w-auto rounded-md border border-input object-cover" />
        )}
        {field.type === 'image' && urls.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {urls.map((u) => (
              <img key={u} src={u} alt="" className="h-20 w-20 rounded-md border border-input object-cover" />
            ))}
          </div>
        )}
        {!field.type.startsWith('image') && singleUrl && (
          <a href={singleUrl} target="_blank" rel="noopener noreferrer"
            className="text-sm text-primary underline break-all">
            {singleUrl.split('/').pop()}
          </a>
        )}
        <input
          type="file"
          accept={accept}
          multiple={multiple}
          disabled={uploading || field.readonly}
          className="block w-full text-sm text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border file:border-input file:text-sm file:bg-background file:text-foreground hover:file:bg-accent cursor-pointer disabled:opacity-50"
          onChange={(e) => void handleFiles(e.target.files)}
        />
        {uploading && <p className="text-xs text-muted-foreground">Uploading…</p>}
      </div>
    )
  }

  // ── BelongsTo (single select, async options) ─────────────
  if (field.type === 'belongsTo') {
    const resourceSlug = field.extra?.['resource'] as string | undefined
    const labelField   = (field.extra?.['displayField'] as string) ?? 'name'
    const [opts, setOpts] = useState<Array<{ value: string; label: string }>>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
      if (!resourceSlug || !uploadBase) { setLoading(false); return }
      fetch(`${uploadBase}/${resourceSlug}/_options?label=${labelField}`)
        .then(r => r.json())
        .then((data) => { setOpts(data as Array<{ value: string; label: string }>); setLoading(false) })
        .catch(() => setLoading(false))
    }, [resourceSlug, labelField, uploadBase])

    return (
      <select
        name={field.name}
        value={(value as string) ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={loading || field.readonly}
        className={inputCls}
      >
        <option value="">{loading ? 'Loading…' : '— None —'}</option>
        {opts.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    )
  }

  // ── BelongsToMany (combobox with chips + create) ──────────
  if (field.type === 'belongsToMany') {
    return (
      <BelongsToManyCombobox
        field={field}
        value={value}
        onChange={onChange}
        uploadBase={uploadBase}
      />
    )
  }

  // ── Custom renderer ──────────────────────────────────────
  const customKey = field.component ?? field.type
  const CustomRenderer = customFieldRenderers[customKey]
  if (CustomRenderer) {
    return <CustomRenderer field={field} value={value} onChange={onChange} />
  }

  // ── Text / Email / Number / Date / Datetime ───────────────
  const typeMap: Record<string, string> = {
    text:     'text',
    email:    'email',
    number:   'number',
    date:     'date',
    datetime: 'datetime-local',
  }
  const inputType = typeMap[field.type] ?? 'text'

  function formatDateValue(v: unknown): string {
    if (!v) return ''
    const d = new Date(v as string)
    if (isNaN(d.getTime())) return String(v)
    if (field.type === 'datetime') {
      // datetime-local expects "YYYY-MM-DDTHH:mm"
      return d.toISOString().slice(0, 16)
    }
    // date expects "YYYY-MM-DD"
    return d.toISOString().slice(0, 10)
  }

  const inputValue = (field.type === 'date' || field.type === 'datetime')
    ? formatDateValue(value)
    : (value as string) ?? ''

  return (
    <input
      type={inputType}
      name={field.name}
      value={inputValue}
      onChange={(e) => onChange(e.target.value)}
      required={field.required}
      readOnly={field.readonly}
      disabled={field.readonly}
      placeholder={(field.extra?.placeholder as string) ?? ''}
      className={inputCls}
    />
  )
}

// ── BelongsToMany Combobox ────────────────────────────────

interface Opt { value: string; label: string }

interface BelongsToManyComboboxProps {
  field:       FieldMeta
  value:       unknown
  onChange:    (value: unknown) => void
  uploadBase?: string
}

const CREATE_SENTINEL = '__create__'

function BelongsToManyCombobox({ field, value, onChange, uploadBase = '' }: BelongsToManyComboboxProps) {
  const resourceSlug = field.extra?.['resource'] as string | undefined
  const labelField   = (field.extra?.['displayField'] as string) ?? 'name'
  const selected     = Array.isArray(value) ? (value as string[]) : []

  const [opts, setOpts]             = useState<Opt[]>([])
  const [loading, setLoading]       = useState(true)
  const [inputValue, setInputValue] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [creating, setCreating]     = useState(false)
  const createInputRef              = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!resourceSlug || !uploadBase) { setLoading(false); return }
    fetch(`${uploadBase}/${resourceSlug}/_options?label=${labelField}`)
      .then(r => r.json())
      .then((data) => { setOpts(data as Opt[]); setLoading(false) })
      .catch(() => setLoading(false))
  }, [resourceSlug, labelField, uploadBase])

  const filtered = opts.filter(o =>
    o.label.toLowerCase().includes(inputValue.toLowerCase()),
  )
  const exactMatch = opts.some(o => o.label.toLowerCase() === inputValue.trim().toLowerCase())
  const showCreate = inputValue.trim().length > 0 && !exactMatch

  function handleValueChange(newIds: string[]) {
    // If the sentinel value was just added, open create dialog instead
    if (newIds.includes(CREATE_SENTINEL)) {
      setCreateName(inputValue.trim())
      setCreateOpen(true)
      // Remove the sentinel from selection
      onChange(newIds.filter(id => id !== CREATE_SENTINEL))
      return
    }
    onChange(newIds)
    setInputValue('')
  }

  function removeChip(id: string) {
    onChange(selected.filter(s => s !== id))
  }

  async function handleCreate() {
    if (!createName.trim() || !resourceSlug || !uploadBase) return
    setCreating(true)
    try {
      const res = await fetch(`${uploadBase}/${resourceSlug}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ [labelField]: createName.trim() }),
      })
      if (!res.ok) throw new Error('Create failed')
      const record = await res.json() as { id: string } & Record<string, unknown>
      const newOpt: Opt = { value: record.id, label: String(record[labelField] ?? createName) }
      setOpts(prev => [...prev, newOpt])
      onChange([...selected, record.id])
      setCreateOpen(false)
      setCreateName('')
      setInputValue('')
    } catch {
      // creation failed — leave state unchanged
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Combobox.Root
        value={selected}
        onValueChange={(ids) => handleValueChange((ids ?? []) as string[])}
        multiple
        inputValue={inputValue}
        onInputValueChange={(v) => setInputValue(v)}
      >
        <Combobox.Chips className="flex flex-wrap gap-1.5 p-1.5 min-h-[42px] rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring">
          {selected.map((id) => {
            const opt = opts.find(o => o.value === id)
            return (
              <Combobox.Chip
                key={id}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium"
              >
                {opt?.label ?? id}
                <Combobox.ChipRemove
                  onClick={() => removeChip(id)}
                  className="hover:text-destructive leading-none ml-0.5 cursor-pointer"
                  aria-label={`Remove ${opt?.label ?? id}`}
                >
                  ×
                </Combobox.ChipRemove>
              </Combobox.Chip>
            )
          })}
          <Combobox.Input
            placeholder={loading ? 'Loading…' : selected.length > 0 ? 'Add more…' : `Search ${field.label}…`}
            disabled={loading || field.readonly}
            className="flex-1 min-w-[120px] px-1.5 py-1 text-sm bg-transparent outline-none"
          />
        </Combobox.Chips>

        <Combobox.Portal>
          <Combobox.Positioner>
            <Combobox.Popup className="z-50 min-w-[220px] max-h-60 overflow-y-auto rounded-md border border-border bg-popover shadow-lg py-1 outline-none">
              {filtered.map((o) => (
                <Combobox.Item
                  key={o.value}
                  value={o.value}
                  className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground outline-none"
                >
                  <Combobox.ItemIndicator className="text-primary shrink-0">
                    <CheckIcon />
                  </Combobox.ItemIndicator>
                  <Combobox.ItemText>{o.label}</Combobox.ItemText>
                </Combobox.Item>
              ))}

              {showCreate && (
                <Combobox.Item
                  value={CREATE_SENTINEL}
                  className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer text-primary data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground outline-none border-t border-border mt-1 pt-2"
                >
                  <span className="shrink-0 font-bold">+</span>
                  <Combobox.ItemText>Create &ldquo;{inputValue.trim()}&rdquo;</Combobox.ItemText>
                </Combobox.Item>
              )}

              {filtered.length === 0 && !showCreate && (
                <Combobox.Empty className="px-3 py-2 text-sm text-muted-foreground">
                  No results.
                </Combobox.Empty>
              )}
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>

      {/* Create dialog */}
      <Dialog.Root open={createOpen} onOpenChange={setCreateOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 bg-black/40 z-50" />
          <Dialog.Popup
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-sm rounded-lg border border-border bg-popover shadow-xl p-6 flex flex-col gap-4"
            onOpenAutoFocus={(e) => { e.preventDefault(); setTimeout(() => createInputRef.current?.focus(), 50) }}
          >
            <Dialog.Title className="text-base font-semibold">
              Create new {field.label}
            </Dialog.Title>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium capitalize">{labelField}</label>
              <input
                ref={createInputRef}
                type="text"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleCreate() } }}
                placeholder={`Enter ${labelField}…`}
                className="w-full rounded-md border border-input px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            <div className="flex justify-end gap-2">
              <Dialog.Close className="px-3 py-1.5 rounded-md text-sm border border-input hover:bg-accent transition-colors">
                Cancel
              </Dialog.Close>
              <button
                type="button"
                onClick={() => void handleCreate()}
                disabled={creating || !createName.trim()}
                className="px-3 py-1.5 rounded-md text-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {creating ? 'Creating…' : 'Create'}
              </button>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}

// ── Icons ─────────────────────────────────────────────────

function CheckIcon() {
  return (
    <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
      <path d="M1 4L3.5 6.5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ChevronIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
