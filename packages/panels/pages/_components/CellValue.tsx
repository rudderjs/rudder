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
