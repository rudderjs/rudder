'use client'

import { useState, useEffect, useCallback } from 'react'
import { resolveTheme, generateThemeCSS } from '@rudderjs/panels'
import type { PanelThemeConfig, PanelThemeMeta } from '@rudderjs/panels'

// ─── Constants ──────────────────────────────────────────────

const PRESETS    = ['default', 'nova', 'maia', 'lyra'] as const
const BASE_COLORS = ['neutral', 'stone', 'zinc', 'slate', 'olive', 'taupe'] as const
const ACCENT_COLORS = [
  'blue', 'red', 'green', 'amber', 'orange', 'cyan',
  'violet', 'purple', 'pink', 'rose', 'emerald', 'teal',
  'indigo', 'fuchsia', 'lime', 'sky',
] as const
const CHART_PALETTES = ['default', 'ocean', 'sunset', 'forest', 'berry'] as const
const RADII = ['none', 'small', 'default', 'medium', 'large'] as const
const ICON_LIBRARIES = ['lucide', 'tabler', 'phosphor', 'remix'] as const

const POPULAR_FONTS = [
  'Inter', 'Geist', 'Space Grotesk', 'Plus Jakarta Sans', 'DM Sans',
  'Manrope', 'Outfit', 'Sora', 'Figtree', 'Poppins',
  'Nunito', 'Raleway', 'Open Sans', 'Lato', 'Roboto',
]

// Accent color preview swatches (light mode primary OKLCH values)
const ACCENT_SWATCHES: Record<string, string> = {
  blue: 'oklch(0.488 0.243 264)', red: 'oklch(0.505 0.213 27)', green: 'oklch(0.517 0.174 149)',
  amber: 'oklch(0.666 0.179 58)', orange: 'oklch(0.601 0.206 50)', cyan: 'oklch(0.55 0.135 200)',
  violet: 'oklch(0.488 0.205 277)', purple: 'oklch(0.496 0.22 292)', pink: 'oklch(0.564 0.2 350)',
  rose: 'oklch(0.514 0.222 16)', emerald: 'oklch(0.532 0.157 163)', teal: 'oklch(0.528 0.121 186)',
  indigo: 'oklch(0.457 0.24 277)', fuchsia: 'oklch(0.542 0.238 322)', lime: 'oklch(0.58 0.2 130)',
  sky: 'oklch(0.539 0.158 222)',
}

// ─── Helpers ────────────────────────────────────────────────

function loadGoogleFont(family: string) {
  if (!family || typeof document === 'undefined') return
  const id = `gfont-${family.replace(/\s+/g, '-').toLowerCase()}`
  if (document.getElementById(id)) return
  const link = document.createElement('link')
  link.id = id
  link.rel = 'stylesheet'
  link.href = `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, '+')}:wght@400;500;600;700&display=swap`
  document.head.appendChild(link)
}

function applyThemeCSS(theme: PanelThemeMeta) {
  // Set CSS variables directly on documentElement for immediate effect.
  // This bypasses any specificity issues with <style> tag ordering.
  const root = document.documentElement
  for (const [key, value] of Object.entries(theme.light)) {
    root.style.setProperty(key, value)
  }
  root.style.setProperty('--radius', theme.radius)
  if (theme.fontFamily?.body) {
    root.style.setProperty('--font-sans', theme.fontFamily.body)
    root.style.setProperty('--default-font-family', theme.fontFamily.body)
  }
  if (theme.fontFamily?.heading) {
    root.style.setProperty('--font-heading', theme.fontFamily.heading)
  }
}

function randomPick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!
}

// ─── Component ──────────────────────────────────────────────

interface ThemeSettingsPageProps {
  panelPath: string
  initialConfig?: Partial<PanelThemeConfig>
}

export function ThemeSettingsPage({ panelPath, initialConfig }: ThemeSettingsPageProps) {
  const codeDefaults = initialConfig ?? {}
  const [config, setConfig] = useState<Partial<PanelThemeConfig>>({ ...codeDefaults })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loaded, setLoaded] = useState(false)

  // Load saved overrides from API on mount
  useEffect(() => {
    fetch(`${panelPath}/api/_theme`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.overrides && Object.keys(data.overrides).length > 0) {
          setConfig(prev => ({
            ...prev,
            ...data.overrides,
            fonts: { ...prev.fonts, ...data.overrides.fonts },
          }))
        }
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelPath])

  // Apply live preview on every change
  useEffect(() => {
    try {
      const merged: PanelThemeConfig = { preset: 'default', ...config }
      console.log('[theme-editor] applying:', merged.preset, merged.baseColor, merged.accentColor)
      const resolved = resolveTheme(merged)
      applyThemeCSS(resolved)
    } catch (e) {
      console.error('[theme-editor] resolveTheme error:', e)
    }
  }, [config])

  // Load fonts when they change
  useEffect(() => {
    if (config.fonts?.body) loadGoogleFont(config.fonts.body)
    if (config.fonts?.heading) loadGoogleFont(config.fonts.heading)
  }, [config.fonts?.body, config.fonts?.heading])

  const update = useCallback((key: string, value: unknown) => {
    setConfig(prev => ({ ...prev, [key]: value }))
    setSaved(false)
  }, [])

  const updateFont = useCallback((key: 'heading' | 'body', value: string) => {
    setConfig(prev => ({
      ...prev,
      fonts: { ...prev.fonts, [key]: value || undefined },
    }))
    setSaved(false)
  }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      await fetch(`${panelPath}/api/_theme`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  const handleReset = async () => {
    await fetch(`${panelPath}/api/_theme`, { method: 'DELETE' })
    setConfig({ ...codeDefaults })
    setSaved(false)
  }

  const handleShuffle = () => {
    setConfig({
      preset: randomPick(PRESETS),
      baseColor: randomPick(BASE_COLORS),
      accentColor: randomPick(ACCENT_COLORS),
      chartPalette: randomPick(CHART_PALETTES),
      radius: randomPick(RADII),
      fonts: config.fonts,
      iconLibrary: config.iconLibrary,
    })
    setSaved(false)
  }

  return (
    <div className="flex h-full">
      {/* Controls Sidebar */}
      <div className="w-72 shrink-0 border-r overflow-y-auto p-5 space-y-6">
        <div>
          <h2 className="text-lg font-semibold mb-4">Theme</h2>
        </div>

        {/* Preset */}
        <ControlGroup label="Style">
          <select
            value={config.preset ?? 'default'}
            onChange={e => update('preset', e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {PRESETS.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
          </select>
        </ControlGroup>

        {/* Base Color */}
        <ControlGroup label="Base Color">
          <div className="flex flex-wrap gap-2">
            {BASE_COLORS.map(c => (
              <button
                key={c}
                onClick={() => update('baseColor', c)}
                className={`w-8 h-8 rounded-full border-2 transition-all ${config.baseColor === c ? 'border-primary ring-2 ring-primary/30' : 'border-border'}`}
                style={{ backgroundColor: `oklch(0.5 0.01 ${c === 'neutral' ? 0 : c === 'stone' ? 75 : c === 'zinc' ? 286 : c === 'slate' ? 264 : c === 'olive' ? 120 : 50})` }}
                title={c.charAt(0).toUpperCase() + c.slice(1)}
              />
            ))}
          </div>
          <span className="text-xs text-muted-foreground mt-1">{(config.baseColor ?? 'neutral').charAt(0).toUpperCase() + (config.baseColor ?? 'neutral').slice(1)}</span>
        </ControlGroup>

        {/* Accent Color */}
        <ControlGroup label="Theme Color">
          <div className="grid grid-cols-8 gap-1.5">
            {ACCENT_COLORS.map(c => (
              <button
                key={c}
                onClick={() => update('accentColor', c)}
                className={`w-7 h-7 rounded-full border-2 transition-all ${config.accentColor === c ? 'border-foreground ring-2 ring-primary/30 scale-110' : 'border-transparent'}`}
                style={{ backgroundColor: ACCENT_SWATCHES[c] }}
                title={c.charAt(0).toUpperCase() + c.slice(1)}
              />
            ))}
          </div>
          {config.accentColor && (
            <span className="text-xs text-muted-foreground mt-1">{config.accentColor.charAt(0).toUpperCase() + config.accentColor.slice(1)}</span>
          )}
        </ControlGroup>

        {/* Chart Palette */}
        <ControlGroup label="Chart Color">
          <select
            value={config.chartPalette ?? 'default'}
            onChange={e => update('chartPalette', e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {CHART_PALETTES.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
          </select>
        </ControlGroup>

        {/* Heading Font */}
        <ControlGroup label="Heading">
          <input
            list="heading-fonts"
            value={config.fonts?.heading ?? ''}
            onChange={e => updateFont('heading', e.target.value)}
            placeholder="Default"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <datalist id="heading-fonts">
            {POPULAR_FONTS.map(f => <option key={f} value={f} />)}
          </datalist>
        </ControlGroup>

        {/* Body Font */}
        <ControlGroup label="Font">
          <input
            list="body-fonts"
            value={config.fonts?.body ?? ''}
            onChange={e => updateFont('body', e.target.value)}
            placeholder="Default"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <datalist id="body-fonts">
            {POPULAR_FONTS.map(f => <option key={f} value={f} />)}
          </datalist>
        </ControlGroup>

        {/* Icon Library */}
        <ControlGroup label="Icon Library">
          <select
            value={config.iconLibrary ?? 'lucide'}
            onChange={e => update('iconLibrary', e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {ICON_LIBRARIES.map(l => <option key={l} value={l}>{l.charAt(0).toUpperCase() + l.slice(1)}</option>)}
          </select>
        </ControlGroup>

        {/* Radius */}
        <ControlGroup label="Radius">
          <div className="flex gap-1">
            {RADII.map(r => (
              <button
                key={r}
                onClick={() => update('radius', r)}
                className={`flex-1 px-2 py-1.5 text-xs rounded-md border transition-all ${config.radius === r ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-input hover:bg-accent'}`}
              >
                {r.charAt(0).toUpperCase() + r.slice(1)}
              </button>
            ))}
          </div>
        </ControlGroup>

        {/* Actions */}
        <div className="space-y-2 pt-4 border-t">
          <button
            onClick={handleShuffle}
            className="w-full px-4 py-2 text-sm rounded-md border border-input bg-background hover:bg-accent transition-colors"
          >
            Shuffle
          </button>
          <button
            onClick={handleReset}
            className="w-full px-4 py-2 text-sm rounded-md border border-input bg-background hover:bg-accent transition-colors text-muted-foreground"
          >
            Reset to Defaults
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Theme'}
          </button>
        </div>
      </div>

      {/* Preview Area */}
      <div className="flex-1 overflow-y-auto p-8">
        <ThemePreview config={config} />
      </div>
    </div>
  )
}

// ─── Sub-components ─────────────────────────────────────────

function ControlGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</label>
      {children}
    </div>
  )
}

function ThemePreview({ config }: { config: Partial<PanelThemeConfig> }) {
  return (
    <div className="space-y-8 max-w-4xl">
      {/* Typography */}
      <div className="space-y-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {config.preset?.toUpperCase() ?? 'DEFAULT'} — {config.fonts?.heading ?? 'System'}
        </p>
        <h1 className="text-3xl font-bold tracking-tight">Designing with rhythm and hierarchy.</h1>
        <p className="text-muted-foreground leading-relaxed">
          A strong body font keeps long-form content readable and balances the visual weight of headings.
          Thoughtful spacing and cadence help paragraphs scan quickly without feeling dense.
        </p>
      </div>

      {/* Color Swatches */}
      <div className="space-y-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Colors</p>
        <div className="flex flex-wrap gap-2">
          {[
            { label: 'bg', cls: 'bg-background border' },
            { label: 'fg', cls: 'bg-foreground' },
            { label: 'primary', cls: 'bg-primary' },
            { label: 'secondary', cls: 'bg-secondary border' },
            { label: 'muted', cls: 'bg-muted border' },
            { label: 'accent', cls: 'bg-accent border' },
            { label: 'destructive', cls: 'bg-destructive' },
          ].map(s => (
            <div key={s.label} className="text-center">
              <div className={`w-12 h-12 rounded-lg ${s.cls}`} />
              <span className="text-[10px] text-muted-foreground mt-1 block">--{s.label.slice(0, 3)}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 mt-2">
          {['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5'].map(c => (
            <div key={c} className="text-center">
              <div className="w-10 h-10 rounded-lg" style={{ backgroundColor: `var(--${c})` }} />
              <span className="text-[10px] text-muted-foreground mt-1 block">--{c.slice(0, 5)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Buttons */}
      <div className="space-y-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Buttons</p>
        <div className="flex flex-wrap gap-3">
          <button className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground font-medium">Button</button>
          <button className="px-4 py-2 text-sm rounded-md bg-secondary text-secondary-foreground font-medium">Secondary</button>
          <button className="px-4 py-2 text-sm rounded-md border border-input bg-background hover:bg-accent font-medium">Outline</button>
          <button className="px-4 py-2 text-sm rounded-md hover:bg-accent font-medium text-muted-foreground">Ghost</button>
          <button className="px-4 py-2 text-sm rounded-md bg-destructive text-white font-medium">Destructive</button>
        </div>
      </div>

      {/* Card + Form */}
      <div className="grid grid-cols-2 gap-6">
        <div className="rounded-lg border bg-card p-6 space-y-4">
          <h3 className="font-semibold">Card Title</h3>
          <p className="text-sm text-muted-foreground">Card description with muted text and standard spacing.</p>
          <div className="space-y-3">
            <input placeholder="Name" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
            <input placeholder="Email" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
            <button className="w-full px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground font-medium">Submit</button>
          </div>
        </div>

        <div className="rounded-lg border bg-card p-6 space-y-4">
          <h3 className="font-semibold">Badges & States</h3>
          <div className="flex flex-wrap gap-2">
            <span className="px-2.5 py-0.5 text-xs rounded-full bg-primary/10 text-primary font-medium">Primary</span>
            <span className="px-2.5 py-0.5 text-xs rounded-full bg-secondary text-secondary-foreground font-medium">Secondary</span>
            <span className="px-2.5 py-0.5 text-xs rounded-full bg-destructive/10 text-destructive font-medium">Destructive</span>
            <span className="px-2.5 py-0.5 text-xs rounded-full bg-green-100 text-green-700 font-medium">Success</span>
            <span className="px-2.5 py-0.5 text-xs rounded-full bg-amber-100 text-amber-700 font-medium">Warning</span>
          </div>
          <div className="space-y-2 mt-4">
            <div className="flex items-center justify-between py-2 border-b text-sm">
              <span>Two-factor authentication</span>
              <span className="text-muted-foreground">Enable</span>
            </div>
            <div className="flex items-center justify-between py-2 border-b text-sm">
              <span>Email notifications</span>
              <span className="text-muted-foreground">Enabled</span>
            </div>
            <div className="flex items-center justify-between py-2 text-sm">
              <span>API access</span>
              <span className="text-muted-foreground">Restricted</span>
            </div>
          </div>
        </div>
      </div>

      {/* Table Preview */}
      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Name</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Role</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {[
              { name: 'Alice Johnson', status: 'Active', role: 'Admin' },
              { name: 'Bob Smith', status: 'Inactive', role: 'Editor' },
              { name: 'Carol Williams', status: 'Active', role: 'Viewer' },
            ].map((row, i) => (
              <tr key={i} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                <td className="px-4 py-3 font-medium">{row.name}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${row.status === 'Active' ? 'bg-green-100 text-green-700' : 'bg-muted text-muted-foreground'}`}>
                    {row.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{row.role}</td>
                <td className="px-4 py-3 text-right">
                  <button className="text-xs text-primary hover:underline">Edit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
