import type { FieldMeta, PanelI18n, NodeMap } from '@boostkit/panels'
import { ensureNodeMap } from '@boostkit/panels'
import { Badge } from '@/components/ui/badge.js'

interface CellValueProps {
  value:     unknown
  type:      string
  extra?:    Record<string, unknown>
  displayTransformed?: boolean
  pathSegment?: string
  i18n:      PanelI18n
}

/**
 * Shared cell renderer used by the resource table page and HasMany relation tables.
 * Handles all field types: belongsTo, belongsToMany, boolean, date, color, tags, image, file, etc.
 */
export function CellValue({ value, type, extra, displayTransformed, pathSegment, i18n }: CellValueProps) {
  if (displayTransformed) {
    return <span>{String(value ?? '')}</span>
  }
  if (type === 'belongsTo') {
    const displayField   = (extra?.['displayField'] as string) ?? 'name'
    const targetResource = extra?.['resource'] as string | undefined
    const related = value as Record<string, unknown> | null | undefined
    if (related && typeof related === 'object') {
      const label = String(related[displayField] ?? '—')
      return (targetResource && pathSegment && related['id'])
        ? <a href={`/${pathSegment}/${targetResource}/${related['id']}`} className="text-primary hover:underline">{label}</a>
        : <span>{label}</span>
    }
    return <span className="text-muted-foreground/40">—</span>
  }
  if (type === 'belongsToMany') {
    const items = Array.isArray(value) ? (value as Record<string, unknown>[]) : []
    if (!items.length) return <span className="text-muted-foreground/40">—</span>
    const displayField   = (extra?.['displayField'] as string) ?? 'name'
    const targetResource = extra?.['resource'] as string | undefined
    return (
      <span className="flex flex-wrap gap-1">
        {items.map((item) => {
          const label = String(item[displayField] ?? item['name'] ?? item['id'] ?? '?')
          return targetResource && pathSegment && item['id']
            ? <Badge key={String(item['id'])} variant="outline"><a href={`/${pathSegment}/${targetResource}/${item['id']}`} className="hover:underline">{label}</a></Badge>
            : <Badge key={String(item['id'] ?? label)} variant="outline">{label}</Badge>
        })}
      </span>
    )
  }
  if (value === null || value === undefined) return <span className="text-muted-foreground/40">—</span>

  // ── Badge mapping — any field can use extra.badge to map values to colored pills ──
  const badgeMap = extra?.['badge'] as Record<string, { color?: string; label?: string }> | undefined
  if (badgeMap && value !== undefined && value !== null) {
    const key    = String(value)
    const config = badgeMap[key]
    if (config) {
      const colors: Record<string, string> = {
        gray:   'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
        red:    'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
        orange: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
        yellow: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
        green:  'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
        blue:   'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
        purple: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
        pink:   'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400',
      }
      const cls = colors[config.color ?? 'gray'] ?? colors['gray']
      return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{config.label ?? key}</span>
    }
  }

  // ── Select — show label from options instead of raw value ──
  if (type === 'select') {
    const options = extra?.['options'] as { label: string; value: string | number | boolean }[] | undefined
    if (options) {
      const opt = options.find(o => String(o.value) === String(value))
      if (opt) return <span>{opt.label}</span>
    }
    return <span>{String(value)}</span>
  }

  // ── Number with progressBar ──
  if (type === 'number' && extra?.['progressBar']) {
    const num   = Number(value) || 0
    const max   = Number(extra['progressMax'] ?? 100)
    const pct   = Math.min(Math.max((num / max) * 100, 0), 100)
    const color = extra['progressColor'] as string | undefined
    return (
      <div className="flex items-center gap-2 min-w-[8rem]">
        <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color ?? 'var(--primary)' }} />
        </div>
        <span className="text-xs text-muted-foreground tabular-nums w-8 text-end">{Math.round(pct)}%</span>
      </div>
    )
  }

  if (type === 'boolean' || type === 'toggle') {
    return <Badge variant={value ? 'default' : 'secondary'}>{value ? i18n.yes : i18n.no}</Badge>
  }
  if (type === 'date' || type === 'datetime') {
    return <span className="text-muted-foreground">{new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(value as string))}</span>
  }
  if (type === 'color') {
    return (
      <span className="flex items-center gap-2">
        <span className="inline-block h-4 w-4 rounded-full border" style={{ backgroundColor: String(value) }} />
        <span className="font-mono text-xs">{String(value)}</span>
      </span>
    )
  }
  if (type === 'tags') {
    const tags: string[] = Array.isArray(value) ? (value as string[])
      : typeof value === 'string' && value ? (() => { try { return JSON.parse(value) } catch { return value.split(',') } })()
      : []
    if (!tags.length) return <span className="text-muted-foreground/40">—</span>
    return (
      <span className="flex flex-wrap gap-1">
        {tags.map((tag) => (
          <Badge key={tag} variant="outline">{tag}</Badge>
        ))}
      </span>
    )
  }
  if (type === 'json' || type === 'repeater') {
    return <span className="text-xs text-muted-foreground font-mono">[JSON]</span>
  }
  if (type === 'content') {
    const map = ensureNodeMap(value)
    const root = map.ROOT
    if (!root || root.nodes.length === 0) return <span className="text-muted-foreground/40">—</span>
    for (const id of root.nodes) {
      const node = map[id]
      if (node && (node.type === 'paragraph' || node.type === 'heading')) {
        const raw = (node.props.text as string) || ''
        const plain = raw.replace(/<[^>]*>/g, '')
        if (plain) return <span className="truncate max-w-[20rem] block">{plain}</span>
      }
    }
    return <span className="text-muted-foreground text-xs">{root.nodes.length} blocks</span>
  }
  if (type === 'richcontent') {
    const json = value as any
    let text = ''
    try {
      const extractText = (node: any): string => {
        if (node.text) return node.text
        if (node.children) return node.children.map(extractText).join(' ')
        return ''
      }
      text = extractText(json?.root ?? {}).slice(0, 100)
    } catch { text = '' }
    if (!text) return <span className="text-muted-foreground/40">—</span>
    return <span className="truncate max-w-[20rem] block">{text}{text.length >= 100 ? '…' : ''}</span>
  }
  if (type === 'builder') {
    const map = ensureNodeMap(value)
    const root = map.ROOT
    const count = root ? root.nodes.length : 0
    if (count === 0) return <span className="text-muted-foreground/40">—</span>
    return <span className="text-xs text-muted-foreground">{count} blocks</span>
  }
  if (type === 'image') {
    const src = String(value)
    if (!src) return <span className="text-muted-foreground/40">—</span>
    return <img src={src} alt="" className="h-10 w-16 object-cover rounded" />
  }
  if (type === 'file') {
    const url = String(value)
    const name = url.split('/').pop() ?? url
    return <a href={url} target="_blank" rel="noreferrer" className="text-xs text-primary underline underline-offset-2 truncate max-w-[12rem] block">{name}</a>
  }
  return <span>{String(value)}</span>
}

/** Resolve the display value for a cell — unwraps belongsTo/belongsToMany relations from the record. */
export function resolveCellValue(record: Record<string, unknown>, f: { name: string; type: string; extra?: Record<string, unknown> }): unknown {
  if (f.type === 'belongsTo') {
    const rel = (f.extra?.['relationName'] as string) ?? (f.name.endsWith('Id') ? f.name.slice(0, -2) : f.name)
    return record[rel]
  }
  if (f.type === 'belongsToMany') {
    return record[f.name]
  }
  return record[f.name]
}
