'use client'

import { useState, useEffect } from 'react'
import type { PanelSchemaElementMeta, PanelStatMeta, PanelColumnMeta, PanelI18n, ChartElementMeta, ChartDataset, ListElementMeta } from '@boostkit/panels'

export interface WidgetRendererProps {
  element:    PanelSchemaElementMeta
  panelPath:  string
  i18n:       PanelI18n
}

export function WidgetRenderer({ element, panelPath, i18n }: WidgetRendererProps) {
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

  if (element.type === 'chart') {
    return <ChartWidget element={element as ChartElementMeta} />
  }

  if (element.type === 'table') {
    return <SchemaTable element={element} panelPath={panelPath} i18n={i18n} />
  }

  if (element.type === 'list') {
    return <ListWidget element={element as ListElementMeta} />
  }

  if ((element as any).type === 'stat-progress') {
    return <StatProgressWidget data={(element as any).data ?? {}} />
  }

  if ((element as any).type === 'user-card') {
    return <UserCardWidget data={(element as any).data ?? {}} />
  }

  return null
}

function StatCard({ stat }: { stat: PanelStatMeta }) {
  return (
    <div className="rounded-xl border bg-card p-5 flex flex-col gap-1 h-full">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{stat.label}</p>
      <p className="text-3xl font-bold tabular-nums">{stat.value.toLocaleString()}</p>
      {stat.description && (
        <p className="text-xs text-muted-foreground mt-0.5">{stat.description}</p>
      )}
      {stat.trend !== undefined && (
        <p className={`text-xs font-medium mt-0.5 ${stat.trend >= 0 ? 'text-green-600' : 'text-red-500'}`}>
          {stat.trend >= 0 ? '\u2191' : '\u2193'} {Math.abs(stat.trend)}%
        </p>
      )}
    </div>
  )
}

function StatsRow({ stats }: { stats: PanelStatMeta[] }) {
  // Single stat — render directly, filling the container
  if (stats.length === 1) return <StatCard stat={stats[0]!} />

  return (
    <div className={`grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-${Math.min(stats.length, 4)}`}>
      {stats.map((stat, i) => <StatCard key={i} stat={stat} />)}
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
                      {'\u2192'}
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

function ChartWidget({ element }: { element: ChartElementMeta }) {
  const [mod, setMod] = useState<typeof import('recharts') | null>(null)

  useEffect(() => {
    import('recharts').then(setMod).catch(() => {})
  }, [])

  if (!mod) {
    return (
      <div className="rounded-xl border bg-card p-5" style={{ height: element.height }}>
        <p className="text-sm font-semibold mb-3">{element.title}</p>
        <div className="h-full animate-pulse bg-muted/30 rounded-lg" />
      </div>
    )
  }

  const { ResponsiveContainer, LineChart, BarChart, PieChart, AreaChart, Line, Bar, Pie, Area, XAxis, YAxis, Tooltip, CartesianGrid, Cell, Legend } = mod
  const colors = ['hsl(var(--primary))', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4']

  // Pie / Doughnut
  if (element.chartType === 'pie' || element.chartType === 'doughnut') {
    const pieData = element.labels.map((label: string, i: number) => ({
      name: label,
      value: element.datasets[0]?.data[i] ?? 0,
    }))
    return (
      <div className="rounded-xl border bg-card p-5">
        <p className="text-sm font-semibold mb-3">{element.title}</p>
        <ResponsiveContainer width="100%" height={element.height}>
          <PieChart>
            <Pie
              data={pieData}
              dataKey="value"
              nameKey="name"
              innerRadius={element.chartType === 'doughnut' ? '60%' : 0}
              outerRadius="80%"
              paddingAngle={2}
            >
              {pieData.map((_: unknown, i: number) => (
                <Cell key={i} fill={(element.datasets[0]?.color ?? colors[i % colors.length]) as string} />
              ))}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </div>
    )
  }

  // Line / Bar / Area
  const data = element.labels.map((label: string, i: number) => {
    const point: Record<string, unknown> = { name: label }
    for (const ds of element.datasets) {
      point[ds.label] = ds.data[i] ?? 0
    }
    return point
  })

  const ChartComp = element.chartType === 'bar' ? BarChart
    : element.chartType === 'area' ? AreaChart
    : LineChart

  return (
    <div className="rounded-xl border bg-card p-5">
      <p className="text-sm font-semibold mb-3">{element.title}</p>
      <ResponsiveContainer width="100%" height={element.height}>
        <ChartComp data={data}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis dataKey="name" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip />
          {element.datasets.length > 1 && <Legend />}
          {element.datasets.map((ds: ChartDataset, i: number) => {
            const color = ds.color ?? colors[i % colors.length]
            if (element.chartType === 'bar') {
              return <Bar key={ds.label} dataKey={ds.label} fill={color} radius={[4, 4, 0, 0]} />
            }
            if (element.chartType === 'area') {
              // @ts-expect-error — recharts types don't handle exactOptionalPropertyTypes
              return <Area key={ds.label} type="monotone" dataKey={ds.label} stroke={color} fill={color} fillOpacity={0.15} strokeWidth={2} />
            }
            // @ts-expect-error — recharts types don't handle exactOptionalPropertyTypes
            return <Line key={ds.label} type="monotone" dataKey={ds.label} stroke={color} strokeWidth={2} dot={{ r: 3 }} />
          })}
        </ChartComp>
      </ResponsiveContainer>
    </div>
  )
}

function ListWidget({ element }: { element: ListElementMeta }) {
  return (
    <div className="rounded-xl border bg-card">
      <div className="px-5 py-3 border-b bg-muted/40">
        <p className="text-sm font-semibold">{element.title}</p>
      </div>
      {element.items.length === 0 ? (
        <p className="px-5 py-4 text-sm text-muted-foreground">No items.</p>
      ) : (
        <ul className="divide-y">
          {element.items.map((item, i) => (
            <li key={i} className="px-5 py-3 flex items-start gap-3">
              {item.icon && <span className="text-base shrink-0 mt-0.5">{item.icon}</span>}
              <div className="flex-1 min-w-0">
                {item.href ? (
                  <a href={item.href} className="text-sm font-medium hover:text-primary transition-colors">
                    {item.label}
                  </a>
                ) : (
                  <p className="text-sm font-medium">{item.label}</p>
                )}
                {item.description && (
                  <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function StatProgressWidget({ data }: { data: Record<string, unknown> }) {
  const value = Number(data?.value ?? 0)
  const max = Number(data?.max ?? 100)
  const label = String(data?.label ?? '')
  const pct = max > 0 ? (value / max) * 100 : 0
  const color = String(data?.color ?? 'hsl(var(--primary))')

  // SVG circular progress
  const radius = 15.9155
  const circumference = 2 * Math.PI * radius

  return (
    <div className="rounded-xl border bg-card p-5 h-full flex items-center gap-4">
      <svg viewBox="0 0 36 36" className="w-14 h-14 shrink-0 -rotate-90">
        <circle
          cx="18" cy="18" r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          className="text-muted/20"
        />
        <circle
          cx="18" cy="18" r={radius}
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeDasharray={`${(pct / 100) * circumference} ${circumference}`}
          strokeLinecap="round"
        />
      </svg>
      <div>
        <p className="text-2xl font-bold tabular-nums">{value}<span className="text-sm font-normal text-muted-foreground">/{max}</span></p>
        {label && <p className="text-xs text-muted-foreground mt-0.5">{label}</p>}
      </div>
    </div>
  )
}

function UserCardWidget({ data }: { data: Record<string, unknown> }) {
  const name = String(data?.name ?? '')
  const role = String(data?.role ?? '')
  const avatar = data?.avatar as string | undefined
  const href = data?.href as string | undefined
  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()

  return (
    <div className="rounded-xl border bg-card p-5 h-full flex items-center gap-4">
      {avatar ? (
        <img src={avatar} alt={name} className="w-12 h-12 rounded-full object-cover shrink-0" />
      ) : (
        <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-semibold shrink-0">
          {initials}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate">{name}</p>
        {role && <p className="text-xs text-muted-foreground">{role}</p>}
      </div>
      {href && (
        <a href={href} className="text-xs text-primary hover:underline shrink-0">View</a>
      )}
    </div>
  )
}

function formatCellValue(value: unknown, i18n: PanelI18n): string {
  if (value === null || value === undefined) return '\u2014'
  if (typeof value === 'boolean') return value ? i18n.yes : i18n.no
  if (value instanceof Date) return new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(value)
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(value))
  }
  return String(value)
}
