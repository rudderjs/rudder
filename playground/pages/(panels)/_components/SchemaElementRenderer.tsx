'use client'

import { useState, useEffect } from 'react'
import type { PanelSchemaElementMeta, PanelStatMeta, PanelI18n, ChartElementMeta, ChartDataset, ListElementMeta, SnippetElementMeta, ExampleElementMeta } from '@boostkit/panels'
import { SchemaTable } from './SchemaTable.js'
import { SchemaForm } from './SchemaForm.js'
import type { SchemaFormMeta } from '@boostkit/panels'
import { CodeBlock, CopyButton } from './CodeBlock.js'

// Extended type to include custom widget types not in PanelSchemaElementMeta
type SchemaElementRendererElement = PanelSchemaElementMeta
  | { type: 'stat-progress'; data: Record<string, unknown> }
  | { type: 'user-card'; data: Record<string, unknown> }

export interface SchemaElementRendererProps {
  element:    SchemaElementRendererElement
  panelPath:  string
  i18n:       PanelI18n
}

export function SchemaElementRenderer({ element, panelPath, i18n }: SchemaElementRendererProps) {
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

  if (element.type === 'code') {
    return <CodeBlock code={(element as { content: string }).content} language={(element as { language?: string }).language} title={(element as { title?: string }).title} lineNumbers={(element as { lineNumbers?: boolean }).lineNumbers} />
  }

  if (element.type === 'snippet') {
    return <SnippetBlock element={element as unknown as SnippetElementMeta} />
  }

  if (element.type === 'example') {
    return <ExampleBlock element={element as unknown as ExampleElementMeta} panelPath={panelPath} i18n={i18n} />
  }

  if (element.type === 'form') {
    return <SchemaForm form={element as unknown as SchemaFormMeta} panelPath={panelPath} i18n={i18n} />
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

  if (element.type === 'stat-progress') {
    return <StatProgressWidget data={element.data ?? {}} />
  }

  if (element.type === 'user-card') {
    return <UserCardWidget data={element.data ?? {}} />
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
  if (stats.length === 1 && stats[0]) return <StatCard stat={stats[0]} />

  return (
    <div className={`grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-${Math.min(stats.length, 4)}`}>
      {stats.map((stat, i) => <StatCard key={i} stat={stat} />)}
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

/* ── Snippet — tabbed code with copy ──────────────────────── */

function SnippetBlock({ element }: { element: SnippetElementMeta }) {
  const [active, setActive] = useState(0)
  const tab = element.tabs[active]

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      {element.title && (
        <div className="px-4 py-2 border-b bg-muted/40">
          <span className="text-xs font-medium text-muted-foreground">{element.title}</span>
        </div>
      )}
      <div className="flex items-center gap-1 px-3 py-2 bg-muted/30 border-b">
        {element.tabs.map((t, i) => (
          <button
            key={t.label}
            type="button"
            onClick={() => setActive(i)}
            className={[
              'px-3 py-1 text-xs font-medium rounded-md transition-colors',
              i === active
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            ].join(' ')}
          >
            {t.label}
          </button>
        ))}
        <div className="flex-1" />
        {tab && <CopyButton code={tab.code} />}
      </div>
      {tab && <CodeBlock code={tab.code} language={tab.language} bare />}
    </div>
  )
}

/* ── Example — live preview + collapsible code ───────────── */

function ExampleBlock({ element, panelPath, i18n }: { element: ExampleElementMeta; panelPath: string; i18n: PanelI18n }) {
  const [showCode, setShowCode] = useState(false)

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3 border-b bg-muted/40">
        <p className="text-sm font-semibold">{element.title}</p>
        {element.description && (
          <p className="text-xs text-muted-foreground mt-0.5">{element.description}</p>
        )}
      </div>

      {/* Live preview */}
      <div className="p-5 flex flex-col gap-4">
        {(element.elements ?? []).map((el: unknown, i: number) => (
          <SchemaElementRenderer
            key={i}
            element={el as PanelSchemaElementMeta}
            panelPath={panelPath}
            i18n={i18n}
          />
        ))}
      </div>

      {/* Code panel */}
      {element.code && (
        <>
          <div className="border-t px-4 py-2 flex items-center justify-between bg-muted/20">
            <button
              type="button"
              onClick={() => setShowCode(!showCode)}
              className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1.5"
            >
              <svg className={`w-3.5 h-3.5 transition-transform ${showCode ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
              {showCode ? 'Hide Code' : 'View Code'}
            </button>
            {showCode && <CopyButton code={element.code} />}
          </div>
          {showCode && (
            <CodeBlock code={element.code} language={element.language} bare />
          )}
        </>
      )}
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
