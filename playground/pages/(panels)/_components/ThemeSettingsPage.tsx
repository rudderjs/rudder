'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { navigate } from 'vike/client/router'
import { resolveTheme, generateThemeCSS } from '@pilotiq/panels'
import type { PanelThemeConfig } from '@pilotiq/panels'
import { useTheme } from './ThemeProvider.js'

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

const ACCENT_SWATCHES: Record<string, string> = {
  blue: 'oklch(0.488 0.243 264)', red: 'oklch(0.505 0.213 27)', green: 'oklch(0.517 0.174 149)',
  amber: 'oklch(0.666 0.179 58)', orange: 'oklch(0.601 0.206 50)', cyan: 'oklch(0.55 0.135 200)',
  violet: 'oklch(0.488 0.205 277)', purple: 'oklch(0.496 0.22 292)', pink: 'oklch(0.564 0.2 350)',
  rose: 'oklch(0.514 0.222 16)', emerald: 'oklch(0.532 0.157 163)', teal: 'oklch(0.528 0.121 186)',
  indigo: 'oklch(0.457 0.24 277)', fuchsia: 'oklch(0.542 0.238 322)', lime: 'oklch(0.58 0.2 130)',
  sky: 'oklch(0.539 0.158 222)',
}

// ─── Helpers ────────────────────────────────────────────────

function randomPick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!
}

/** Apply theme to parent page via inline styles on <html> — immediate visual update. */
function applyToParent(config: Partial<PanelThemeConfig>) {
  const merged: PanelThemeConfig = { preset: 'default', ...config }
  const resolved = resolveTheme(merged)
  const root = document.documentElement
  const isDark = root.classList.contains('dark')
  const vars = isDark ? resolved.dark : resolved.light

  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value)
  }
  root.style.setProperty('--radius', resolved.radius)
  if (resolved.fontFamily?.body) {
    root.style.setProperty('--font-sans', resolved.fontFamily.body)
    root.style.setProperty('--default-font-family', resolved.fontFamily.body)
  }
  if (resolved.fontFamily?.heading) {
    root.style.setProperty('--font-heading', resolved.fontFamily.heading)
  }
}

/** Build the preview iframe HTML with inline CSS variables. */
function buildPreviewHTML(config: Partial<PanelThemeConfig>, mode: 'light' | 'dark' = 'light'): string {
  const merged: PanelThemeConfig = { preset: 'default', ...config }
  const resolved = resolveTheme(merged)
  const themeCSS = generateThemeCSS(resolved)

  // Google Fonts links
  const fontLinks: string[] = []
  if (config.fonts?.body) fontLinks.push(config.fonts.body)
  if (config.fonts?.heading && config.fonts.heading !== config.fonts.body) fontLinks.push(config.fonts.heading)
  const fontTags = fontLinks.map(f =>
    `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${f.replace(/ /g, '+')}:wght@400;500;600;700&display=swap">`
  ).join('\n')

  const bodyFont = resolved.fontFamily?.body ?? "'Geist Variable', sans-serif"
  const headingFont = resolved.fontFamily?.heading ?? bodyFont

  return `<!DOCTYPE html>
<html lang="en" class="${mode}">
<head>
<meta charset="UTF-8">
${fontTags}
<style>
  ${themeCSS}
  * { box-sizing: border-box; margin: 0; padding: 0; border: 0 solid; }
  body {
    font-family: ${bodyFont};
    background: var(--background);
    color: var(--foreground);
    padding: 2rem;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  h1, h2, h3, h4, h5, h6 { font-family: ${headingFont}; }
  .space-y > * + * { margin-top: 1.5rem; }
  .space-y-sm > * + * { margin-top: 0.75rem; }
  .flex { display: flex; }
  .flex-wrap { flex-wrap: wrap; }
  .gap-2 { gap: 0.5rem; }
  .gap-3 { gap: 0.75rem; }
  .gap-6 { gap: 1.5rem; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; }
  .text-xs { font-size: 0.75rem; }
  .text-sm { font-size: 0.875rem; }
  .text-lg { font-size: 1.125rem; }
  .text-3xl { font-size: 1.875rem; }
  .font-medium { font-weight: 500; }
  .font-semibold { font-weight: 600; }
  .font-bold { font-weight: 700; }
  .tracking-tight { letter-spacing: -0.025em; }
  .uppercase { text-transform: uppercase; }
  .tracking-wider { letter-spacing: 0.05em; }
  .rounded-md { border-radius: calc(var(--radius) - 2px); }
  .rounded-lg { border-radius: var(--radius); }
  .rounded-full { border-radius: 9999px; }
  .border { border-width: 1px; border-style: solid; border-color: var(--border); }
  .border-b { border-bottom: 1px solid var(--border); }
  .swatch { width: 3rem; height: 3rem; border-radius: var(--radius); }
  .swatch-sm { width: 2.5rem; height: 2.5rem; border-radius: var(--radius); }
  .label { font-size: 0.625rem; color: var(--muted-foreground); margin-top: 0.25rem; text-align: center; }
  .btn { padding: 0.5rem 1rem; font-size: 0.875rem; font-weight: 500; border-radius: calc(var(--radius) - 2px); cursor: pointer; display: inline-flex; align-items: center; }
  .card { border: 1px solid var(--border); border-radius: var(--radius); background: var(--card); color: var(--card-foreground); padding: 1.5rem; }
  .input { width: 100%; border: 1px solid var(--input); border-radius: calc(var(--radius) - 2px); background: var(--background); padding: 0.5rem 0.75rem; font-size: 0.875rem; color: var(--foreground); outline: none; }
  .badge { padding: 0.125rem 0.625rem; font-size: 0.75rem; font-weight: 500; border-radius: 9999px; display: inline-block; }
  table { width: 100%; font-size: 0.875rem; border-collapse: collapse; }
  th { text-align: left; padding: 0.75rem 1rem; font-weight: 500; color: var(--muted-foreground); }
  td { padding: 0.75rem 1rem; }
  thead tr { border-bottom: 1px solid var(--border); background: color-mix(in oklch, var(--muted) 50%, transparent); }
  tbody tr { border-bottom: 1px solid var(--border); }
  tbody tr:last-child { border-bottom: none; }
  .section-label { font-size: 0.75rem; font-weight: 500; color: var(--muted-foreground); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.75rem; }
</style>
</head>
<body>
<div class="space-y">

  <!-- Typography -->
  <div>
    <p class="section-label">${(config.preset ?? 'default').toUpperCase()} &mdash; ${config.fonts?.heading ?? 'System'}</p>
    <h1 class="text-3xl font-bold tracking-tight" style="margin-top:0.5rem">Designing with rhythm and hierarchy.</h1>
    <p style="color:var(--muted-foreground);margin-top:0.75rem;line-height:1.625">
      A strong body font keeps long-form content readable and balances the visual weight of headings.
      Thoughtful spacing and cadence help paragraphs scan quickly without feeling dense.
    </p>
  </div>

  <!-- Color Swatches -->
  <div>
    <p class="section-label">Colors</p>
    <div class="flex flex-wrap gap-2">
      <div style="text-align:center"><div class="swatch border" style="background:var(--background)"></div><div class="label">--bg</div></div>
      <div style="text-align:center"><div class="swatch" style="background:var(--foreground)"></div><div class="label">--fg</div></div>
      <div style="text-align:center"><div class="swatch" style="background:var(--primary)"></div><div class="label">--pri</div></div>
      <div style="text-align:center"><div class="swatch border" style="background:var(--secondary)"></div><div class="label">--sec</div></div>
      <div style="text-align:center"><div class="swatch border" style="background:var(--muted)"></div><div class="label">--mut</div></div>
      <div style="text-align:center"><div class="swatch border" style="background:var(--accent)"></div><div class="label">--acc</div></div>
      <div style="text-align:center"><div class="swatch" style="background:var(--destructive)"></div><div class="label">--des</div></div>
    </div>
    <div class="flex flex-wrap gap-2" style="margin-top:0.5rem">
      <div style="text-align:center"><div class="swatch-sm" style="background:var(--chart-1)"></div><div class="label">--cha1</div></div>
      <div style="text-align:center"><div class="swatch-sm" style="background:var(--chart-2)"></div><div class="label">--cha2</div></div>
      <div style="text-align:center"><div class="swatch-sm" style="background:var(--chart-3)"></div><div class="label">--cha3</div></div>
      <div style="text-align:center"><div class="swatch-sm" style="background:var(--chart-4)"></div><div class="label">--cha4</div></div>
      <div style="text-align:center"><div class="swatch-sm" style="background:var(--chart-5)"></div><div class="label">--cha5</div></div>
    </div>
  </div>

  <!-- Buttons -->
  <div>
    <p class="section-label">Buttons</p>
    <div class="flex flex-wrap gap-3">
      <button class="btn" style="background:var(--primary);color:var(--primary-foreground)">Button</button>
      <button class="btn" style="background:var(--secondary);color:var(--secondary-foreground)">Secondary</button>
      <button class="btn border" style="background:var(--background);color:var(--foreground)">Outline</button>
      <button class="btn" style="background:transparent;color:var(--muted-foreground)">Ghost</button>
      <button class="btn" style="background:var(--destructive);color:#fff">Destructive</button>
    </div>
  </div>

  <!-- Cards -->
  <div class="grid-2">
    <div class="card space-y-sm">
      <h3 class="font-semibold">Card Title</h3>
      <p class="text-sm" style="color:var(--muted-foreground)">Card description with muted text and standard spacing.</p>
      <div class="space-y-sm">
        <input class="input" placeholder="Name">
        <input class="input" placeholder="Email">
        <button class="btn" style="background:var(--primary);color:var(--primary-foreground);width:100%;justify-content:center">Submit</button>
      </div>
    </div>
    <div class="card space-y-sm">
      <h3 class="font-semibold">Badges &amp; States</h3>
      <div class="flex flex-wrap gap-2">
        <span class="badge" style="background:color-mix(in oklch, var(--primary) 10%, transparent);color:var(--primary)">Primary</span>
        <span class="badge" style="background:var(--secondary);color:var(--secondary-foreground)">Secondary</span>
        <span class="badge" style="background:color-mix(in oklch, var(--destructive) 10%, transparent);color:var(--destructive)">Destructive</span>
        <span class="badge" style="background:oklch(0.962 0.044 156.743);color:oklch(0.527 0.154 150.069)">Success</span>
        <span class="badge" style="background:oklch(0.962 0.059 95.617);color:oklch(0.555 0.163 48.998)">Warning</span>
      </div>
      <div style="margin-top:1rem">
        <div class="flex border-b" style="justify-content:space-between;padding:0.5rem 0;font-size:0.875rem;align-items:center">
          <span>Two-factor authentication</span><span style="color:var(--muted-foreground)">Enable</span>
        </div>
        <div class="flex border-b" style="justify-content:space-between;padding:0.5rem 0;font-size:0.875rem;align-items:center">
          <span>Email notifications</span><span style="color:var(--muted-foreground)">Enabled</span>
        </div>
        <div class="flex" style="justify-content:space-between;padding:0.5rem 0;font-size:0.875rem;align-items:center">
          <span>API access</span><span style="color:var(--muted-foreground)">Restricted</span>
        </div>
      </div>
    </div>
  </div>

  <!-- Table -->
  <div class="border rounded-lg" style="overflow:hidden">
    <table>
      <thead><tr><th>Name</th><th>Status</th><th>Role</th><th style="text-align:right">Actions</th></tr></thead>
      <tbody>
        <tr><td class="font-medium">Alice Johnson</td><td><span class="badge" style="background:oklch(0.962 0.044 156.743);color:oklch(0.527 0.154 150.069)">Active</span></td><td style="color:var(--muted-foreground)">Admin</td><td style="text-align:right"><a style="color:var(--primary);font-size:0.75rem;cursor:pointer">Edit</a></td></tr>
        <tr><td class="font-medium">Bob Smith</td><td><span class="badge" style="background:var(--muted);color:var(--muted-foreground)">Inactive</span></td><td style="color:var(--muted-foreground)">Editor</td><td style="text-align:right"><a style="color:var(--primary);font-size:0.75rem;cursor:pointer">Edit</a></td></tr>
        <tr><td class="font-medium">Carol Williams</td><td><span class="badge" style="background:oklch(0.962 0.044 156.743);color:oklch(0.527 0.154 150.069)">Active</span></td><td style="color:var(--muted-foreground)">Viewer</td><td style="text-align:right"><a style="color:var(--primary);font-size:0.75rem;cursor:pointer">Edit</a></td></tr>
      </tbody>
    </table>
  </div>

</div>
</body>
</html>`
}

// ─── Preview Iframe ─────────────────────────────────────────

function PreviewIframe({ config, mode }: { config: Partial<PanelThemeConfig>; mode: 'light' | 'dark' }) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return
    const html = buildPreviewHTML(config, mode)
    const doc = iframe.contentDocument
    if (doc) {
      doc.open()
      doc.write(html)
      doc.close()
    }
    if (!ready) {
      const timer = setTimeout(() => setReady(true), 200)
      return () => clearTimeout(timer)
    }
  }, [config, mode, ready])

  return (
    <div className="relative w-full h-full">
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center rounded-lg border border-border bg-background z-10">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
        </div>
      )}
      <iframe
        ref={iframeRef}
        className={`w-full h-full rounded-lg border border-border bg-background transition-opacity duration-150 ${ready ? 'opacity-100' : 'opacity-0'}`}
        title="Theme Preview"
      />
    </div>
  )
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
  const { resolved: previewMode } = useTheme()

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
    applyToParent(config)
    try {
      await fetch(`${panelPath}/api/_theme`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      // Re-navigate to force Vike to re-fetch server data with saved theme.
      const scrollY = window.scrollY
      await navigate(`${panelPath}/theme`, { overwriteLastHistoryEntry: true, scrollToTop: false } as Parameters<typeof navigate>[1])
      requestAnimationFrame(() => window.scrollTo(0, scrollY))
    } catch { /* visual update already applied */ }
    setSaved(true)
    setSaving(false)
  }

  const handleReset = async () => {
    applyToParent(codeDefaults)
    try {
      await fetch(`${panelPath}/api/_theme`, { method: 'DELETE' })
      const scrollY = window.scrollY
      await navigate(`${panelPath}/theme`, { overwriteLastHistoryEntry: true, scrollToTop: false } as Parameters<typeof navigate>[1])
      requestAnimationFrame(() => window.scrollTo(0, scrollY))
    } catch { /* visual update already applied */ }
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
      <div className="w-72 shrink-0 overflow-y-auto p-5 space-y-6">
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
          <select
            value={config.baseColor ?? 'neutral'}
            onChange={e => update('baseColor', e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {BASE_COLORS.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
          </select>
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
          <select
            value={config.fonts?.heading ?? ''}
            onChange={e => updateFont('heading', e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">Default</option>
            {POPULAR_FONTS.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </ControlGroup>

        {/* Body Font */}
        <ControlGroup label="Font">
          <select
            value={config.fonts?.body ?? ''}
            onChange={e => updateFont('body', e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">Default</option>
            {POPULAR_FONTS.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
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

      {/* Preview Area — isolated iframe, syncs with panel dark/light toggle */}
      <div className="flex-1 overflow-hidden p-4">
        <PreviewIframe config={config} mode={previewMode} />
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
