import { useState, useMemo, useEffect } from 'react'
import type { PanelI18n, FieldMeta } from '@pilotiq/panels'

export interface VersionEntry {
  id:        string
  label?:    string
  createdAt: string
  userId?:   string
}

interface Props {
  pathSegment:    string
  slug:           string
  id:             string
  /** Current live form values */
  values:         Record<string, unknown>
  /** Form field metadata (for labels and display) */
  fields:         FieldMeta[]
  /** Callback to restore a single field value */
  onRestoreField: (name: string, value: unknown) => void
  /** Callback to restore all fields at once */
  onRestoreAll:   (values: Record<string, unknown>) => void
  i18n:           PanelI18n & Record<string, string>
}

/** Fields to skip in comparison (internal/readonly) */
const SKIP_FIELDS = new Set(['id', 'createdAt', 'updatedAt', 'deletedAt', 'draftStatus'])

export function VersionHistory({ pathSegment, slug, id, values, fields, onRestoreField, onRestoreAll, i18n }: Props) {
  const [versions, setVersions]     = useState<VersionEntry[]>([])
  const [loading, setLoading]       = useState(false)
  const [loaded, setLoaded]         = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [versionData, setVersionData] = useState<Record<string, unknown> | null>(null)
  const [loadingVersion, setLoadingVersion] = useState(false)

  // Build field label map for display
  const fieldLabels = useMemo(() => {
    const map = new Map<string, string>()
    function collect(items: unknown[]) {
      for (const item of items) {
        const f = item as FieldMeta & { fields?: unknown[]; tabs?: { fields?: unknown[] }[] }
        if (f.name) map.set(f.name, f.label || f.name)
        if (f.fields) collect(f.fields)
        if (f.type === 'tabs' && f.tabs) for (const tab of f.tabs) { if (tab.fields) collect(tab.fields) }
      }
    }
    collect(fields)
    return map
  }, [fields])

  async function loadVersions() {
    if (loaded) return
    setLoading(true)
    try {
      const res = await fetch(`/${pathSegment}/api/${slug}/${id}/_versions`)
      if (res.ok) {
        const body = await res.json() as { data: VersionEntry[] }
        setVersions(body.data ?? [])
      }
    } finally {
      setLoading(false)
      setLoaded(true)
    }
  }

  async function selectVersion(versionId: string) {
    setSelectedId(versionId)
    setLoadingVersion(true)
    try {
      const res = await fetch(`/${pathSegment}/api/${slug}/${id}/_versions/${versionId}`)
      if (res.ok) {
        const body = await res.json() as { data: { fields: Record<string, unknown> } }
        setVersionData(body.data.fields)
      }
    } finally {
      setLoadingVersion(false)
    }
  }

  // Load on first render
  useEffect(() => { if (!loaded && !loading) void loadVersions() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Compute which fields differ between current and selected version
  const diffs = useMemo(() => {
    if (!versionData) return []
    const result: { name: string; label: string; current: unknown; version: unknown }[] = []
    const allKeys = new Set([...Object.keys(values), ...Object.keys(versionData)])
    for (const key of allKeys) {
      if (SKIP_FIELDS.has(key)) continue
      const current = values[key]
      const version = versionData[key]
      if (JSON.stringify(current) !== JSON.stringify(version)) {
        result.push({
          name: key,
          label: fieldLabels.get(key) ?? key,
          current,
          version,
        })
      }
    }
    return result
  }, [values, versionData, fieldLabels])

  function handleRestoreAll() {
    if (!versionData) return
    // Only restore fields that differ and are not skipped
    const toRestore: Record<string, unknown> = {}
    for (const diff of diffs) {
      toRestore[diff.name] = diff.version
    }
    onRestoreAll(toRestore)
    import('sonner').then(({ toast }) => toast.success(i18n.allFieldsRestored ?? 'All fields restored.')).catch(() => {})
  }

  return (
    <div className="w-80 shrink-0">
      <div className="rounded-xl border border-border bg-card">
        {/* Header */}
        <div className="px-4 py-3 border-b border-border bg-muted/40">
          <p className="text-sm font-semibold">{i18n.versionHistory ?? 'Version History'}</p>
        </div>

        {/* Version list */}
        <div className="p-3 border-b border-border max-h-48 overflow-y-auto">
          {loading && <p className="text-sm text-muted-foreground">{i18n.loading ?? 'Loading...'}</p>}
          {!loading && versions.length === 0 && (
            <p className="text-sm text-muted-foreground">{i18n.noVersions ?? 'No versions yet.'}</p>
          )}
          {versions.map((v, idx) => {
            const isSelected = v.id === selectedId
            const isCurrent = idx === 0 && !selectedId
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => selectVersion(v.id)}
                className={[
                  'flex items-center gap-2 w-full text-left py-2 px-2 rounded-md text-sm transition-colors',
                  isSelected ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-accent/50',
                  isCurrent ? 'opacity-50' : '',
                ].join(' ')}
              >
                {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />}
                <div className="min-w-0">
                  <p className="truncate">{v.label ?? (idx === 0 ? (i18n.currentVersion ?? 'Current') : new Date(v.createdAt).toLocaleString())}</p>
                  <p className="text-xs text-muted-foreground">{new Date(v.createdAt).toLocaleString()}</p>
                </div>
              </button>
            )
          })}
        </div>

        {/* Comparison view */}
        {selectedId && (
          <div className="p-3 max-h-[400px] overflow-y-auto">
            {loadingVersion && <p className="text-sm text-muted-foreground">{i18n.loading ?? 'Loading...'}</p>}

            {!loadingVersion && diffs.length === 0 && versionData && (
              <p className="text-sm text-muted-foreground">{i18n.noChanges ?? 'No differences found.'}</p>
            )}

            {!loadingVersion && diffs.length > 0 && (
              <>
                {/* Restore all button */}
                <button
                  type="button"
                  onClick={handleRestoreAll}
                  className="w-full mb-3 px-3 py-2 text-xs font-medium text-primary-foreground bg-primary rounded-md hover:bg-primary/90"
                >
                  {i18n.restoreAll ?? `Restore All (${diffs.length} changes)`}
                </button>

                {/* Per-field diffs */}
                {diffs.map((diff) => (
                  <div key={diff.name} className="mb-3 rounded-lg border border-border overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-1.5 bg-muted/40 border-b border-border">
                      <span className="text-xs font-medium">{diff.label}</span>
                      <button
                        type="button"
                        onClick={() => onRestoreField(diff.name, diff.version)}
                        className="text-xs text-primary hover:underline"
                      >
                        {i18n.restore ?? 'Restore'}
                      </button>
                    </div>
                    <div className="px-3 py-2 space-y-1">
                      <div>
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Current</span>
                        <p className="text-xs truncate max-w-[250px]">{formatValue(diff.current)}</p>
                      </div>
                      <div>
                        <span className="text-[10px] uppercase tracking-wider text-green-500">Version</span>
                        <p className="text-xs truncate max-w-[250px] text-green-600 dark:text-green-400">{formatValue(diff.version)}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** Format a value for display in the comparison view */
function formatValue(val: unknown): string {
  if (val === null || val === undefined) return '(empty)'
  if (typeof val === 'boolean') return val ? 'Yes' : 'No'
  if (typeof val === 'string') return val || '(empty)'
  if (typeof val === 'number') return String(val)
  if (typeof val === 'object') {
    // Lexical JSON — show text preview
    const root = (val as Record<string, unknown>).root as { children?: unknown[] } | undefined
    if (root?.children) {
      return extractText(root.children).slice(0, 100) || '(rich content)'
    }
    // Array (tags, etc.)
    if (Array.isArray(val)) return val.join(', ') || '(empty)'
    return JSON.stringify(val).slice(0, 80)
  }
  return String(val)
}

/** Extract plain text from Lexical JSON children */
function extractText(children: unknown[]): string {
  let text = ''
  for (const child of children) {
    const node = child as Record<string, unknown>
    if (node.text) text += String(node.text)
    if (node.children) text += extractText(node.children as unknown[])
    if (node.type === 'paragraph' || node.type === 'heading') text += ' '
  }
  return text.trim()
}
