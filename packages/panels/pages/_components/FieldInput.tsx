import { Checkbox } from '@base-ui-components/react/checkbox'
import { Select } from '@base-ui-components/react/select'
import type { FieldMeta } from '@boostkit/panels'
import { customFieldRenderers } from './CustomFieldRenderers.js'

interface Props {
  field:    FieldMeta
  value:    unknown
  onChange: (value: unknown) => void
}

export function FieldInput({ field, value, onChange }: Props) {
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

  return (
    <input
      type={inputType}
      name={field.name}
      value={(value as string) ?? ''}
      onChange={(e) => onChange(e.target.value)}
      required={field.required}
      readOnly={field.readonly}
      disabled={field.readonly}
      placeholder={(field.extra?.placeholder as string) ?? ''}
      className={inputCls}
    />
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
