import { useState, useEffect, useRef, useMemo } from 'react'
import { Checkbox } from '@base-ui-components/react/checkbox'
import { Dialog } from '@base-ui-components/react/dialog'
import { Select } from '@base-ui-components/react/select'
import { Switch } from '@base-ui-components/react/switch'
import type { FieldMeta, PanelI18n, NodeMap } from '@boostkit/panels'
import { ensureNodeMap, addNode, updateNodeProps, removeNode, reorderNode } from '@boostkit/panels'
import { CollaborativeInput } from './collaborative/CollaborativeInput.js'
import { CollaborativeTextarea } from './collaborative/CollaborativeTextarea.js'
import { customFieldRenderers } from './CustomFieldRenderers.js'
import { SortableBlockList } from './SortableBlockList.js'
import { ContentEditor } from './ContentEditor.js'

interface Props {
  field:       FieldMeta
  value:       unknown
  onChange:    (value: unknown) => void
  /** API base URL for the active panel (e.g. '/admin/api'). Required for FileField / ImageField. */
  uploadBase?: string
  i18n:        PanelI18n
  disabled?:   boolean
  /** Y.Text instance for collaborative text sync (optional) */
  yText?:      any | null
  /** Awareness instance for cursor broadcasting (optional) */
  awareness?:  any | null
}

function generateSlug(str: string): string {
  return str.toLowerCase().trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function t(template: string, vars: Record<string, string | number>): string {
  return template.replace(/:([a-z]+)/g, (_, k) => String(vars[k] ?? `:${k}`))
}

export function FieldInput({ field, value, onChange, uploadBase = '', i18n, disabled = false, yText, awareness }: Props) {
  const inputCls = 'w-full rounded-md border border-input px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent disabled:bg-muted disabled:text-muted-foreground'
  const isDisabled = disabled || field.readonly

  // ── Boolean ─────────────────────────────────────────────
  if (field.type === 'boolean') {
    return (
      <div className="flex items-center gap-3">
        <Checkbox.Root
          checked={!!value}
          onCheckedChange={(checked) => !isDisabled && onChange(checked)}
          disabled={isDisabled}
          className="h-5 w-5 rounded border-2 border-input bg-background flex items-center justify-center transition-colors data-[checked]:bg-primary data-[checked]:border-primary focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
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
        onValueChange={(v) => !isDisabled && onChange(v)}
        name={field.name}
        disabled={isDisabled}
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
    if (yText && awareness) {
      return (
        <CollaborativeTextarea
          value={(value as string) ?? ''}
          onChange={(v) => onChange(v)}
          yText={yText}
          awareness={awareness}
          fieldName={field.name}
          rows={(field.extra?.rows as number) ?? 4}
          className={inputCls}
          placeholder={(field.extra?.placeholder as string) ?? ''}
          disabled={isDisabled}
          required={field.required}
          readOnly={field.readonly}
          name={field.name}
        />
      )
    }
    return (
      <textarea
        name={field.name}
        value={(value as string) ?? ''}
        onChange={(e) => onChange(e.target.value)}
        rows={(field.extra?.rows as number) ?? 4}
        required={field.required}
        readOnly={field.readonly}
        disabled={isDisabled}
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
          disabled={isDisabled}
          placeholder="••••••••"
          autoComplete="new-password"
          className={inputCls}
        />
        {!!field.extra?.confirm && (
          <input
            type="password"
            name={`${field.name}_confirmation`}
            placeholder={i18n.confirmPassword}
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
          disabled={isDisabled}
          placeholder="my-slug"
          className="flex-1 px-3 py-2 text-sm bg-background focus:outline-none disabled:bg-muted disabled:text-muted-foreground"
        />
      </div>
    )
  }

  // ── Tags ─────────────────────────────────────────────────
  if (field.type === 'tags') {
    const tags: string[] = Array.isArray(value) ? (value as string[]) : (typeof value === 'string' && value ? (() => { try { return JSON.parse(value) as string[] } catch { return value.split(',') } })() : [])

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
          placeholder={(field.extra?.placeholder as string) ?? i18n.addTag}
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
          onCheckedChange={(c) => !isDisabled && onChange(c)}
          disabled={isDisabled}
          className={[
            'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent',
            'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            checked ? 'bg-primary' : 'bg-muted',
            isDisabled ? 'opacity-50 cursor-not-allowed' : '',
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
          disabled={isDisabled}
          className="h-9 w-14 cursor-pointer rounded border border-input bg-background p-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
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
          disabled={isDisabled}
          className={[inputCls, 'font-mono text-xs', jsonError ? 'border-destructive' : ''].join(' ')}
          onChange={(e) => {
            try {
              JSON.parse(e.target.value)
              setJsonError(null)
              onChange(e.target.value)
            } catch {
              setJsonError(i18n.invalidJson)
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
    const addLabel = (field.extra?.addLabel as string) ?? i18n.addItem
    const maxItems = field.extra?.maxItems as number | undefined
    const nodeMap  = ensureNodeMap(value)
    const root     = nodeMap.ROOT!
    const nodeIds  = root.nodes

    function emit(next: NodeMap) { onChange(next) }

    function handleAddItem() {
      if (maxItems !== undefined && nodeIds.length >= maxItems) return
      const props: Record<string, unknown> = {}
      for (const f of schema) props[f.name] = undefined
      const { map } = addNode(nodeMap, 'item', props)
      emit(map)
    }

    function handleReorder(id: string, fromIndex: number, toIndex: number) {
      emit(reorderNode(nodeMap, id, fromIndex, toIndex))
    }

    return (
      <div className="flex flex-col gap-3">
        <SortableBlockList
          nodeIds={nodeIds}
          onReorder={handleReorder}
          disabled={isDisabled}
          renderNode={(id, index) => {
            const node = nodeMap[id]
            if (!node) return null
            return (
              <div className="rounded-lg border border-input bg-card p-4 flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    {t(i18n.item, { n: index + 1 })}
                  </span>
                  {!isDisabled && (
                    <button
                      type="button"
                      onClick={() => emit(removeNode(nodeMap, id))}
                      className="text-xs text-destructive hover:underline"
                    >
                      {i18n.remove}
                    </button>
                  )}
                </div>

                {schema.map((subField) => (
                  <div key={subField.name} className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium">
                      {subField.label}
                      {subField.required && <span className="text-destructive ml-0.5">*</span>}
                    </label>
                    <FieldInput
                      field={subField}
                      value={node.props[subField.name]}
                      onChange={(v) => emit(updateNodeProps(nodeMap, id, { [subField.name]: v }))}
                      uploadBase={uploadBase}
                      i18n={i18n}
                    />
                  </div>
                ))}
              </div>
            )
          }}
        />

        {!isDisabled && (maxItems === undefined || nodeIds.length < maxItems) && (
          <button
            type="button"
            onClick={handleAddItem}
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
    const addLabel  = (field.extra?.addLabel as string) ?? i18n.addBlock
    const maxItems  = field.extra?.maxItems as number | undefined
    const nodeMap   = ensureNodeMap(value)
    const root      = nodeMap.ROOT!
    const nodeIds   = root.nodes
    const [pickerOpen, setPickerOpen] = useState(false)

    function emit(next: NodeMap) { onChange(next) }

    function handleAddBlock(blockName: string) {
      const def = blockDefs.find((b) => b.name === blockName)
      if (!def) return
      const props: Record<string, unknown> = {}
      for (const f of def.schema) props[f.name] = undefined
      const { map } = addNode(nodeMap, blockName, props)
      emit(map)
      setPickerOpen(false)
    }

    function handleReorder(id: string, fromIndex: number, toIndex: number) {
      emit(reorderNode(nodeMap, id, fromIndex, toIndex))
    }

    const atMax = maxItems !== undefined && nodeIds.length >= maxItems

    return (
      <div className="flex flex-col gap-3">
        <SortableBlockList
          nodeIds={nodeIds}
          onReorder={handleReorder}
          disabled={isDisabled}
          renderNode={(id) => {
            const node = nodeMap[id]
            if (!node) return null
            const def = blockDefs.find((b) => b.name === node.type)
            return (
              <div className="rounded-lg border border-input bg-card overflow-hidden">
                {/* Block header */}
                <div className="flex items-center justify-between px-4 py-2 bg-muted/50 border-b border-input">
                  <span className="flex items-center gap-2 text-xs font-medium">
                    {def?.icon && <span>{def.icon}</span>}
                    <span className="text-muted-foreground uppercase tracking-wide">
                      {def?.label ?? node.type}
                    </span>
                  </span>
                  {!isDisabled && (
                    <button
                      type="button"
                      onClick={() => emit(removeNode(nodeMap, id))}
                      className="px-1.5 py-0.5 text-xs text-destructive hover:underline"
                    >{i18n.remove}</button>
                  )}
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
                        value={node.props[subField.name]}
                        onChange={(v) => emit(updateNodeProps(nodeMap, id, { [subField.name]: v }))}
                        uploadBase={uploadBase}
                        i18n={i18n}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )
          }}
        />

        {/* Block picker */}
        {!atMax && !isDisabled && (
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
                    onClick={() => handleAddBlock(def.name)}
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
          disabled={uploading || isDisabled}
          className="block w-full text-sm text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border file:border-input file:text-sm file:bg-background file:text-foreground hover:file:bg-accent cursor-pointer disabled:opacity-50"
          onChange={(e) => void handleFiles(e.target.files)}
        />
        {uploading && <p className="text-xs text-muted-foreground">{i18n.uploading}</p>}
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
        disabled={loading || isDisabled}
        className={inputCls}
      >
        <option value="">{loading ? i18n.loading : i18n.none}</option>
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
        i18n={i18n}
        disabled={isDisabled}
      />
    )
  }

  // ── Content ─────────────────────────────────────────────
  if (field.type === 'content') {
    const allowedBlocks = field.extra?.blockTypes as string[] | undefined
    const placeholder   = field.extra?.placeholder as string | undefined
    const maxBlocks     = field.extra?.maxBlocks as number | undefined
    return (
      <ContentEditor
        value={value}
        onChange={onChange}
        allowedBlocks={allowedBlocks}
        placeholder={placeholder}
        maxBlocks={maxBlocks}
        uploadBase={uploadBase}
        disabled={isDisabled}
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

  // Collaborative text input for text/email fields
  if ((field.type === 'text' || field.type === 'email') && yText && awareness) {
    return (
      <CollaborativeInput
        value={(value as string) ?? ''}
        onChange={(v) => onChange(v)}
        yText={yText}
        awareness={awareness}
        fieldName={field.name}
        type={inputType}
        className={inputCls}
        placeholder={(field.extra?.placeholder as string) ?? ''}
        disabled={isDisabled}
        required={field.required}
        readOnly={field.readonly}
        name={field.name}
      />
    )
  }

  return (
    <input
      type={inputType}
      name={field.name}
      value={inputValue}
      onChange={(e) => onChange(e.target.value)}
      required={field.required}
      readOnly={field.readonly}
      disabled={isDisabled}
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
  i18n:        PanelI18n
  disabled?:   boolean
}

function BelongsToManyCombobox({ field, value, onChange, uploadBase = '', i18n, disabled = false }: BelongsToManyComboboxProps) {
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
  }, [createOpen, createSchema, JSON.stringify(createValues)])

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
        toggle(filtered[focusedIdx]!.value)
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

  const inputCls = 'w-full rounded-md border border-input px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent disabled:bg-muted disabled:text-muted-foreground'

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
                    className={inputCls}
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
