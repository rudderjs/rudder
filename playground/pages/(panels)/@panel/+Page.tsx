'use client'

import { useData }   from 'vike-react/useData'
import { useConfig } from 'vike-react/useConfig'
import type { Data } from './+data.js'
import type { PanelSchemaElementMeta, PanelStatMeta, PanelColumnMeta, PanelI18n } from '@boostkit/panels'

export default function PanelRootPage() {
  const config = useConfig()
  const { panelMeta, schemaData } = useData<Data>()
  const panelName = panelMeta.branding?.title ?? panelMeta.name
  config({ title: panelName })

  if (!schemaData || schemaData.length === 0) return null

  const i18n = panelMeta.i18n

  return (
    <div className="flex flex-col gap-6">
      {schemaData.map((el, i) => (
        <SchemaElement key={i} element={el} panelPath={panelMeta.path} i18n={i18n} />
      ))}
    </div>
  )
}

function SchemaElement({ element, panelPath, i18n }: { element: PanelSchemaElementMeta; panelPath: string; i18n: PanelI18n }) {
  if (element.type === 'text') {
    return <p className="text-sm text-muted-foreground">{element.content}</p>
  }

  if (element.type === 'heading') {
    const Tag = (`h${element.level}`) as 'h1' | 'h2' | 'h3'
    const cls = element.level === 1
      ? 'text-2xl font-bold'
      : element.level === 2
      ? 'text-xl font-semibold'
      : 'text-lg font-semibold'
    return <Tag className={cls}>{element.content}</Tag>
  }

  if (element.type === 'stats') {
    return <StatsRow stats={element.stats} />
  }

  if (element.type === 'table') {
    return <SchemaTable element={element} panelPath={panelPath} i18n={i18n} />
  }

  return null
}

function StatsRow({ stats }: { stats: PanelStatMeta[] }) {
  return (
    <div className={`grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-${Math.min(stats.length, 4)}`}>
      {stats.map((stat, i) => (
        <div key={i} className="rounded-xl border bg-card p-5 flex flex-col gap-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{stat.label}</p>
          <p className="text-3xl font-bold tabular-nums">{stat.value.toLocaleString()}</p>
          {stat.description && (
            <p className="text-xs text-muted-foreground mt-0.5">{stat.description}</p>
          )}
          {stat.trend !== undefined && (
            <p className={`text-xs font-medium mt-0.5 ${stat.trend >= 0 ? 'text-green-600' : 'text-red-500'}`}>
              {stat.trend >= 0 ? '↑' : '↓'} {Math.abs(stat.trend)}%
            </p>
          )}
        </div>
      ))}
    </div>
  )
}

function SchemaTable({ element, panelPath: _, i18n }: { element: Extract<PanelSchemaElementMeta, { type: 'table' }>; panelPath: string; i18n: PanelI18n }) {
  const records = element.records as Record<string, unknown>[]

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b bg-muted/40">
        <p className="text-sm font-semibold">{element.title}</p>
        <a href={element.href} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
          {i18n.viewAll}
        </a>
      </div>
      {records.length === 0 ? (
        <p className="px-5 py-4 text-sm text-muted-foreground">{i18n.noRecordsFound}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/20">
                {element.columns.map((col: PanelColumnMeta) => (
                  <th key={col.name} className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    {col.label}
                  </th>
                ))}
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {records.map((record, i) => (
                <tr key={(record['id'] as string) ?? i} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                  {element.columns.map((col: PanelColumnMeta) => (
                    <td key={col.name} className="px-4 py-2.5 text-muted-foreground">
                      {formatCellValue(record[col.name], i18n)}
                    </td>
                  ))}
                  <td className="px-4 py-2.5 text-right">
                    <a
                      href={`${element.href}/${record['id']}`}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      →
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function formatCellValue(value: unknown, i18n: PanelI18n): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? i18n.yes : i18n.no
  if (value instanceof Date) return new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(value)
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(value))
  }
  return String(value)
}
