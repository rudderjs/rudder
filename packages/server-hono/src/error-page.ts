import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { buildEditorUrl, resolveEditor } from './editor-launch.js'

/**
 * Resolve the framework version to show on the error page's `RUDDERJS` badge —
 * the app's installed `@rudderjs/core` (the canonical number `rudder about` and
 * the dev banner report), resolved from the app's `node_modules` via a
 * `createRequire` rooted at the cwd. Falls back to this adapter's own version,
 * then `null` (badge omitted). Best-effort; never throws.
 *
 * Mirrors `@rudderjs/vite`'s `resolveRudderVersion()`. Reading this adapter's
 * OWN `package.json` (the previous approach) reported the *adapter* version
 * mislabeled as "RudderJS", and leaked a hard-coded `1.x` placeholder whenever
 * the on-disk read failed (bundled/serverless deploys). `@internal` — exposed
 * for tests; `fromDir` overrides the resolution root.
 */
export function resolveRudderVersion(fromDir: string = process.cwd()): string | null {
  let req: NodeJS.Require
  try {
    req = createRequire(path.join(fromDir, 'package.json'))
  } catch {
    return null
  }
  for (const name of ['@rudderjs/core', '@rudderjs/server-hono']) {
    try {
      const meta = req(`${name}/package.json`) as { version?: string }
      if (typeof meta.version === 'string') return meta.version
    } catch { /* try next */ }
  }
  return null
}

/**
 * @internal — exposed for tests.
 *
 * Dev-only — apply Vite's sourcemap-based stack rewriter (registered on
 * `globalThis` by @rudderjs/vite's `configureServer`) so error rendering
 * resolves eval'd SSR module-runner frames to true source positions instead of
 * transformed-coordinate lines. This is the PRIMARY line-accuracy mechanism;
 * `resolveErrorLine` below is the heuristic fallback for when no sourcemap remap
 * is available (tsx-run CLI errors, or the hook absent). Mutates `err.stack` in
 * place. No-op in production (the hook is never registered) or on failure.
 */
export function applyDevStackFix(err: Error): void {
  const fix = (globalThis as Record<string, unknown>)['__rudderjs_fix_stacktrace__']
  if (typeof fix === 'function') {
    try { (fix as (e: Error) => void)(err) } catch { /* keep original stack */ }
  }
}

interface StackFrame {
  func: string
  file: string
  line: number
  col:  number
  isVendor: boolean
}

function parseStack(stack: string): StackFrame[] {
  return stack.split('\n').slice(1).flatMap(raw => {
    const m = raw.match(/^\s+at (.+?) \((.+?):(\d+):(\d+)\)$/)
           ?? raw.match(/^\s+at (.+?):(\d+):(\d+)$/)
    if (!m) return []
    const [func, file, line, col] = m.length === 5
      ? [m[1] ?? '', m[2] ?? '', m[3] ?? '', m[4] ?? '']
      : ['<anonymous>', m[1] ?? '', m[2] ?? '', m[3] ?? '']
    const cleanFile = file.replace(/^file:\/\//, '')
    return [{
      func,
      file: cleanFile,
      line: parseInt(line),
      col:  parseInt(col),
      isVendor: cleanFile.includes('node_modules'),
    }]
  })
}

/** Matches `throw ` / `throw new …` / `abort(` anywhere in a trimmed line. */
const ERROR_TRIGGER = /(?:^|[\s.;{}(])(?:throw\s|abort\s*\()/

/**
 * @internal — exposed for tests.
 *
 * Resolve the reported error line to the actual throw / abort site.
 *
 * Heuristic FALLBACK — `applyDevStackFix` (sourcemap remap) is the primary
 * mechanism and normally feeds this an already-correct line. This runs only
 * when no remap is available (tsx-run CLI errors, or the dev hook absent).
 *
 * Both `tsx` and Vite SSR's Module Runner report inaccurate line numbers in
 * dev: `new Function()`-evaluated modules don't honor `--enable-source-maps`,
 * and `ssr.sourcemap: 'inline'` is silently ignored by Vite. In practice the
 * offset is anywhere from a few lines (tsx) to ~90+ lines (Vite SSR on a
 * playground route file).
 *
 * Strategy:
 *   1. If the reported line is a real code statement (non-empty, not a
 *      comment), trust it. The frame may point at a call site whose callee
 *      throws — line is still meaningful for the developer.
 *   2. Otherwise scan forward up to 150 lines for a `throw `/`abort(` line.
 *      150 chosen to cover observed Vite SSR offsets without overshooting a
 *      typical multi-route file.
 *   3. If nothing matches, return `null` so the renderer drops the
 *      source-context section entirely — better than misleading the reader
 *      with an unrelated comment block, which is what the previous "first
 *      non-empty line" fallback produced (see #442 follow-up).
 */
export function resolveErrorLine(lines: string[], reported: number): number | null {
  const reported0 = reported - 1
  const trimmed = lines[reported0]?.trim() ?? ''

  // Real code on the reported line: trust it. Skip empty + comment-only.
  if (trimmed && !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*')) {
    return reported
  }

  const WINDOW = 150
  for (let i = reported0 + 1; i < Math.min(lines.length, reported0 + WINDOW); i++) {
    const t = lines[i]?.trim() ?? ''
    if (!t || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue
    if (ERROR_TRIGGER.test(t)) return i + 1
  }

  return null
}

function sourceContext(file: string, reportedLine: number): Array<{ n: number; code: string; isError: boolean }> | null {
  try {
    const lines     = fs.readFileSync(file, 'utf-8').split('\n')
    const errorLine = resolveErrorLine(lines, reportedLine)
    if (errorLine === null) return null
    const start    = Math.max(0, errorLine - 6)
    const end      = Math.min(lines.length, errorLine + 4)
    return lines.slice(start, end).map((code, i) => ({
      n:       start + i + 1,
      code,
      isError: start + i + 1 === errorLine,
    }))
  } catch {
    return null
  }
}

function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function rel(file: string): string {
  return file.replace(process.cwd() + '/', '').replace(process.env['HOME'] ?? '', '~')
}

/**
 * Render the error context as a Markdown string suitable for pasting into an
 * AI chat. Mirrors the visible page sections (header, source context, stack,
 * request) but in a format LLMs ingest without parsing HTML.
 *
 * Headers are kept as-is — the user explicitly chose to copy, and the visible
 * page shows them too. If pasting into a public chat, review the Headers
 * section before sending.
 */
export function buildErrorMarkdown(
  error: Error,
  req:   { method: string; url: string; headers: Record<string, string> },
  parts: {
    frames:        StackFrame[]
    appFrames:     StackFrame[]
    topFrame?:     StackFrame
    source:        Array<{ n: number; code: string; isError: boolean }> | null
    nodeVersion:   string
    rudderjsVersion: string
  },
): string {
  const lines: string[] = []
  lines.push(`# ${error.name}: ${error.message}`)
  lines.push('')
  if (parts.topFrame) {
    lines.push(`**Location**: \`${rel(parts.topFrame.file)}:${parts.topFrame.line}\``)
  }
  lines.push(`**Request**: \`${req.method} ${req.url}\``)
  lines.push(`**Versions**: Node ${parts.nodeVersion} · Rudder ${parts.rudderjsVersion}`)

  if (parts.source && parts.topFrame) {
    lines.push('')
    lines.push('## Source')
    lines.push('')
    lines.push(`\`${rel(parts.topFrame.file)}\``)
    lines.push('')
    lines.push('```ts')
    for (const l of parts.source) {
      const marker = l.isError ? '>' : ' '
      lines.push(`${marker} ${String(l.n).padStart(4)} | ${l.code}`)
    }
    lines.push('```')
  }

  if (parts.appFrames.length > 0) {
    lines.push('')
    lines.push('## Stack')
    lines.push('')
    lines.push('```')
    for (const f of parts.appFrames) {
      lines.push(`at ${f.func} (${rel(f.file)}:${f.line}:${f.col})`)
    }
    lines.push('```')
  }

  const vendorFrames = parts.frames.filter(f => f.isVendor)
  if (vendorFrames.length > 0) {
    lines.push('')
    lines.push(`<details><summary>${vendorFrames.length} vendor frames</summary>`)
    lines.push('')
    lines.push('```')
    for (const f of vendorFrames) {
      lines.push(`at ${f.func} (${rel(f.file)}:${f.line}:${f.col})`)
    }
    lines.push('```')
    lines.push('')
    lines.push('</details>')
  }

  const headerEntries = Object.entries(req.headers)
  if (headerEntries.length > 0) {
    lines.push('')
    lines.push('## Request Headers')
    lines.push('')
    for (const [k, v] of headerEntries) {
      lines.push(`- \`${k}\`: ${v}`)
    }
  }

  return lines.join('\n')
}

export function renderErrorPage(
  error: Error,
  req: { method: string; url: string; headers: Record<string, string> },
): string {
  const frames    = parseStack(error.stack ?? '')
  const appFrames = frames.filter(f => !f.isVendor)
  const topFrame  = appFrames[0] ?? frames[0]
  const source    = topFrame ? sourceContext(topFrame.file, topFrame.line) : null
  const vendorCount = frames.filter(f => f.isVendor).length

  const nodeVersion = process.version
  // The app's installed @rudderjs/core version, or null when it can't be
  // resolved (badge + markdown then omit it rather than show a placeholder).
  const rudderjsVersion = resolveRudderVersion()

  // Pre-render the Markdown copy so the client-side button just reads a
  // server-rendered string — no DOM-parsing or formatting in the browser.
  // Two-step escape:
  //   1. JSON.stringify handles quotes / backslashes / control chars.
  //   2. Replace `<`, `>`, `&`, U+2028, U+2029 with their \uXXXX escapes so
  //      an attacker-controlled `</script>` in error.message can't close the
  //      inline script block. The escape sequences survive JSON.parse and
  //      decode back to `<`/`>`/etc when the button writes to clipboard.
  const markdownPayload = JSON.stringify(buildErrorMarkdown(error, req, {
    frames,
    appFrames,
    ...(topFrame ? { topFrame } : {}),
    source,
    nodeVersion,
    rudderjsVersion: rudderjsVersion ?? 'unknown',
  })).replace(/[<>&\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))

  // Editor-launch on stack frames — wraps the file:line label in an anchor
  // when `APP_EDITOR` resolves to a known editor (default 'vscode'). Click
  // dispatches `vscode://file/...` / `cursor://file/...` / `webstorm://open?...`
  // etc. — the browser hands the scheme to the OS, which routes to the IDE.
  // Set `APP_EDITOR=none` to disable wrapping (renders as plain text).
  const editor = resolveEditor()
  // Primary "Open in editor" action — targets the top application frame (the
  // line a developer almost always wants). Null when `APP_EDITOR=none` or the
  // top frame is unknown (e.g. an error with no stack), in which case the
  // button is omitted entirely.
  const topFrameEditorUrl = topFrame ? buildEditorUrl(editor, topFrame.file, topFrame.line) : null
  const frameLabel = (f: StackFrame) => {
    const label = `${esc(rel(f.file))}:${f.line}`
    const url   = buildEditorUrl(editor, f.file, f.line)
    return url
      ? `<a class="frame-file-link" href="${esc(url)}" title="Open in editor">${label}</a>`
      : label
  }
  const frameRow = (f: StackFrame, isApp: boolean) => `
    <div class="frame${isApp ? ' app' : ''}">
      <span class="frame-func">${esc(f.func)}</span>
      <span class="frame-file">${frameLabel(f)}</span>
    </div>`

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(error.name)} — Rudder</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{background:#0d0d0f;color:#d4d4d4;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.6}
.top-bar{display:flex;align-items:center;gap:8px;padding:12px 24px;background:#18181b;border-bottom:1px solid #27272a;color:#ef4444;font-weight:600;font-size:13px}
.dot{width:8px;height:8px;background:#ef4444;border-radius:50%;flex-shrink:0}
.container{max-width:1100px;margin:0 auto;padding:40px 24px}
h1{font-size:28px;font-weight:700;color:#f4f4f5;margin:0}
.title-row{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:4px}
.actions{display:flex;align-items:center;gap:8px;flex-shrink:0}
.location{font-size:13px;color:#71717a;margin-bottom:12px;font-family:ui-monospace,monospace}
.message{font-size:17px;color:#a1a1aa;margin-bottom:24px}
.badges{display:flex;align-items:center;gap:8px;margin-bottom:32px;flex-wrap:wrap}
.badge{display:inline-flex;align-items:center;line-height:1;padding:5px 10px;border-radius:4px;font-size:11px;font-weight:700;font-family:ui-monospace,monospace;letter-spacing:.04em}
.badge-gray{background:#27272a;color:#a1a1aa}
.badge-red{background:#450a0a;color:#f87171}
.request-bar{display:flex;align-items:center;gap:10px;background:#18181b;border:1px solid #27272a;border-radius:8px;padding:12px 16px;margin-bottom:36px}
.badge-orange{background:#422006;color:#fb923c}
.badge-status{background:#450a0a;color:#f87171;padding:3px 10px;border-radius:4px;font-size:11px;font-weight:700;font-family:ui-monospace,monospace}
.url{font-family:ui-monospace,monospace;color:#d4d4d4;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.section{margin-bottom:32px}
.section-title{font-size:11px;font-weight:700;color:#71717a;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px}
.card{background:#18181b;border:1px solid #27272a;border-radius:8px;overflow:hidden}
.frame{padding:10px 16px;border-bottom:1px solid #27272a;display:flex;align-items:center;justify-content:space-between;gap:16px}
.frame:last-child{border-bottom:none}
.frame-func{font-family:ui-monospace,monospace;font-size:12px;color:#71717a;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.frame-file{font-family:ui-monospace,monospace;font-size:12px;color:#52525b;flex-shrink:0}
.frame-file-link{color:inherit;text-decoration:none;border-bottom:1px dotted transparent;transition:border-color .1s}
.frame-file-link:hover{border-bottom-color:currentColor}
.frame.app .frame-func{color:#e4e4e7}
.frame.app .frame-file{color:#60a5fa}
.vendor-toggle{color:#52525b;font-size:12px;cursor:pointer;padding:10px 16px;display:flex;align-items:center;justify-content:space-between;background:#18181b;border-top:1px solid #27272a}
.vendor-toggle:hover{color:#a1a1aa}
.vendor-frames{display:none}
.vendor-frames.open{display:block}
.code-block{font-family:ui-monospace,monospace;font-size:13px;line-height:1.8}
.code-line{display:flex}
.code-line-num{min-width:52px;padding:0 12px;color:#52525b;user-select:none;text-align:right;border-right:2px solid #27272a;flex-shrink:0}
.code-line-src{padding:0 16px;white-space:pre;color:#a1a1aa}
.code-line.error{background:#2d0a0a}
.code-line.error .code-line-num{color:#f87171;border-color:#ef4444}
.code-line.error .code-line-src{color:#fca5a5}
table{width:100%;border-collapse:collapse}
table tr{border-bottom:1px solid #27272a}
table tr:last-child{border-bottom:none}
table th{text-align:left;padding:8px 16px;color:#52525b;font-weight:500;width:200px;font-size:12px;font-family:ui-monospace,monospace}
table td{padding:8px 16px;font-family:ui-monospace,monospace;font-size:12px;color:#a1a1aa;word-break:break-all}
.copy-btn,.action-btn{display:inline-flex;align-items:center;line-height:1;gap:6px;background:#27272a;color:#e4e4e7;border:1px solid #3f3f46;border-radius:6px;padding:7px 12px;font-size:12px;font-family:inherit;font-weight:600;cursor:pointer;text-decoration:none;transition:background .12s,border-color .12s}
.open-editor-btn{background:#0c2a4a;border-color:#1d4ed8;color:#bfdbfe}
.open-editor-btn:hover{background:#10366b;border-color:#3b82f6}
.copy-btn:hover{background:#3f3f46;border-color:#52525b}
.copy-btn:active{background:#18181b}
.copy-btn.copied{background:#064e3b;border-color:#10b981;color:#a7f3d0}
.copy-btn-icon{width:14px;height:14px;flex-shrink:0}
</style>
</head>
<body>

<div class="top-bar">
  <div class="dot"></div>
  Internal Server Error
</div>

<div class="container">
  <div class="title-row">
    <h1>${esc(error.name)}</h1>
    <div class="actions">
      ${topFrameEditorUrl ? `<a class="action-btn open-editor-btn" href="${esc(topFrameEditorUrl)}" title="Open ${esc(rel(topFrame!.file))}:${topFrame!.line} in your editor (APP_EDITOR=${esc(editor)})">
        <svg class="copy-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="16 18 22 12 16 6"></polyline>
          <polyline points="8 6 2 12 8 18"></polyline>
        </svg>
        <span>Open in editor</span>
      </a>` : ''}
      <button class="copy-btn" id="rjs-copy-md" type="button" title="Copy error context as Markdown — paste into an AI chat for debugging">
        <svg class="copy-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
        <span>Copy as Markdown</span>
      </button>
    </div>
  </div>
  ${topFrame ? `<div class="location">${esc(rel(topFrame.file))}:${topFrame.line}</div>` : ''}
  <div class="message">${esc(error.message)}</div>

  <div class="badges">
    <span class="badge badge-gray">NODE ${esc(nodeVersion)}</span>
    ${rudderjsVersion ? `<span class="badge badge-gray">RUDDERJS ${esc(rudderjsVersion)}</span>` : ''}
    <span class="badge badge-red">UNHANDLED</span>
  </div>

  <div class="request-bar">
    <span class="badge-status">500</span>
    <span class="badge badge-orange">${esc(req.method)}</span>
    <span class="url">${esc(req.url)}</span>
  </div>

  ${source ? `
  <div class="section">
    <div class="section-title">Exception Source</div>
    <div class="card code-block">
      ${source.map(l => `<div class="code-line${l.isError ? ' error' : ''}"><span class="code-line-num">${l.n}</span><span class="code-line-src">${esc(l.code)}</span></div>`).join('')}
    </div>
  </div>` : ''}

  <div class="section">
    <div class="section-title">Exception Trace</div>
    <div class="card">
      ${appFrames.map(f => frameRow(f, true)).join('')}
      ${vendorCount > 0 ? `
        <div class="vendor-toggle" onclick="var el=this.nextElementSibling;el.classList.toggle('open');this.querySelector('span').textContent=el.classList.contains('open')?'Hide ${vendorCount} vendor frames':'${vendorCount} vendor frames'">
          <span>${vendorCount} vendor frames</span><span>↕</span>
        </div>
        <div class="vendor-frames">
          ${frames.filter(f => f.isVendor).map(f => frameRow(f, false)).join('')}
        </div>` : ''}
    </div>
  </div>

  <div class="section">
    <div class="section-title">Request Headers</div>
    <div class="card">
      <table>
        ${Object.entries(req.headers).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(String(v))}</td></tr>`).join('')}
      </table>
    </div>
  </div>
</div>

<script>
(function(){
  var btn = document.getElementById('rjs-copy-md');
  if (!btn) return;
  var md = ${markdownPayload};
  var labelEl = btn.querySelector('span');
  var defaultLabel = labelEl ? labelEl.textContent : 'Copy as Markdown';
  btn.addEventListener('click', async function () {
    try {
      // Clipboard API requires a secure context (https or localhost);
      // both are true for the dev error page, so no fallback needed.
      await navigator.clipboard.writeText(md);
      btn.classList.add('copied');
      if (labelEl) labelEl.textContent = 'Copied!';
      setTimeout(function () {
        btn.classList.remove('copied');
        if (labelEl) labelEl.textContent = defaultLabel;
      }, 1600);
    } catch (err) {
      // Surface the failure inline so the user isn't left wondering why
      // nothing happened — common cause is the tab not being focused.
      if (labelEl) labelEl.textContent = 'Copy failed — focus the tab and retry';
      setTimeout(function () { if (labelEl) labelEl.textContent = defaultLabel }, 2400);
    }
  });
})();
</script>

</body>
</html>`
}
