import fs from 'node:fs'

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
      ? [m[1]!, m[2]!, m[3]!, m[4]!]
      : ['<anonymous>', m[1]!, m[2]!, m[3]!]
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

/**
 * tsx source maps can report an off line number (e.g. an empty line).
 * Scan forward from the reported line to find the actual throw/error statement.
 */
function resolveErrorLine(lines: string[], reported: number): number {
  const reported0 = reported - 1 // 0-indexed
  // If the reported line is non-empty, trust it
  if (lines[reported0]?.trim()) return reported
  // Scan forward up to 20 lines for a throw statement
  for (let i = reported0 + 1; i < Math.min(lines.length, reported0 + 20); i++) {
    if (lines[i]?.trimStart().startsWith('throw ')) return i + 1
  }
  // Fallback: first non-empty line
  for (let i = reported0 + 1; i < Math.min(lines.length, reported0 + 20); i++) {
    if (lines[i]?.trim()) return i + 1
  }
  return reported
}

function sourceContext(file: string, reportedLine: number): Array<{ n: number; code: string; isError: boolean }> | null {
  try {
    const lines    = fs.readFileSync(file, 'utf-8').split('\n')
    const errorLine = resolveErrorLine(lines, reportedLine)
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
  const boostkitVersion = '0.0.2'

  const frameRow = (f: StackFrame, isApp: boolean) => `
    <div class="frame${isApp ? ' app' : ''}">
      <span class="frame-func">${esc(f.func)}</span>
      <span class="frame-file">${esc(rel(f.file))}:${f.line}</span>
    </div>`

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(error.name)} — BoostKit</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{background:#0d0d0f;color:#d4d4d4;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.6}
.top-bar{display:flex;align-items:center;gap:8px;padding:12px 24px;background:#18181b;border-bottom:1px solid #27272a;color:#ef4444;font-weight:600;font-size:13px}
.dot{width:8px;height:8px;background:#ef4444;border-radius:50%;flex-shrink:0}
.container{max-width:1100px;margin:0 auto;padding:40px 24px}
h1{font-size:28px;font-weight:700;color:#f4f4f5;margin-bottom:4px}
.location{font-size:13px;color:#71717a;margin-bottom:12px;font-family:ui-monospace,monospace}
.message{font-size:17px;color:#a1a1aa;margin-bottom:24px}
.badges{display:flex;gap:8px;margin-bottom:32px;flex-wrap:wrap}
.badge{padding:3px 10px;border-radius:4px;font-size:11px;font-weight:700;font-family:ui-monospace,monospace;letter-spacing:.04em}
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
</style>
</head>
<body>

<div class="top-bar">
  <div class="dot"></div>
  Internal Server Error
</div>

<div class="container">
  <h1>${esc(error.name)}</h1>
  ${topFrame ? `<div class="location">${esc(rel(topFrame.file))}:${topFrame.line}</div>` : ''}
  <div class="message">${esc(error.message)}</div>

  <div class="badges">
    <span class="badge badge-gray">NODE ${esc(nodeVersion)}</span>
    <span class="badge badge-gray">BOOSTKIT ${esc(boostkitVersion)}</span>
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

</body>
</html>`
}
