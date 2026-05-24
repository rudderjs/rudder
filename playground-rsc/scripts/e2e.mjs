// Production RSC end-to-end gate.
//
// Builds are done by the caller (`vike build`); this script owns the server
// lifecycle: it boots `dist/server/index.mjs`, drives a headless chromium
// through the server-rendered page AND the `"use server"` action round-trip,
// and exits non-zero on any failure.
//
// We boot the PRODUCTION build (not `vike dev`) — same choice as the scaffolder
// render-check — so there's no Vite dep-optimizer warmup flakiness. This single
// gate covers the integration surface that broke repeatedly during the
// vike-react-rsc bring-up:
//   - prod build: the SSR server entry + the RSC page-config manifest
//   - scanner codegen: route via +config.ts, framework hooks via import: strings
//   - single vike / vite / @vitejs/plugin-rsc resolution (no dual instances)
//   - the /_rsc action route (mounted directly → no re-entrant renderPageServer)
//
// If a future vike / @vitejs/plugin-rsc bump (or a re-vendor of vike-react-rsc)
// breaks any of those, this fails in CI instead of in a user's app.

import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const SERVER_ENTRY = './dist/server/index.mjs'
const BOOT_TIMEOUT_MS = 30_000
const NAV_TIMEOUT_MS = 20_000

// ── Boot the production server; resolve its base URL from the "Listening on" log ──
function bootServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [SERVER_ENTRY], {
      env: { ...process.env, APP_ENV: 'production', NODE_ENV: 'production' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    const timer = setTimeout(() => {
      proc.kill('SIGKILL')
      reject(new Error(`server did not report a listening URL within ${BOOT_TIMEOUT_MS}ms\n--- server output ---\n${out}`))
    }, BOOT_TIMEOUT_MS)

    const onData = (buf) => {
      out += buf.toString()
      const m = out.match(/https?:\/\/(?:localhost|127\.0\.0\.1)(?::(\d+))?/i)
      if (m) {
        clearTimeout(timer)
        const port = m[1] ?? '80'
        resolve({ proc, baseUrl: `http://localhost:${port}` })
      }
    }
    proc.stdout.on('data', onData)
    proc.stderr.on('data', onData)
    proc.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`server exited before listening (code ${code})\n--- server output ---\n${out}`))
    })
  })
}

async function run() {
  const { proc, baseUrl } = await bootServer()
  console.log(`▶ booted production server at ${baseUrl}`)

  const browser = await chromium.launch({ headless: true })
  const failures = []
  try {
    const page = await browser.newPage()
    page.on('pageerror', (e) => failures.push(`page error: ${e.message}`))
    page.on('console', (m) => { if (m.type() === 'error') failures.push(`console.error: ${m.text()}`) })

    // 1) Server-rendered RSC view
    const res = await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT_MS })
    if (!res || res.status() !== 200) failures.push(`GET / → ${res ? res.status() : 'no response'} (expected 200)`)
    const html = res ? await res.text() : ''
    for (const marker of ['RudderJS', 'Increment (server action)']) {
      if (!html.includes(marker)) failures.push(`SSR marker "${marker}" missing from initial HTML`)
    }

    // 2) "use server" action round-trip — the island hydrates and the RPC mutates server state
    const countEl = page.locator("p:has-text('Count:') strong").first()
    const initial = (await countEl.innerText().catch(() => 'N/A')).trim()
    if (initial !== '0') failures.push(`initial count = ${JSON.stringify(initial)} (expected "0")`)

    const btn = page.getByRole('button', { name: 'Increment (server action)' })
    for (const expected of ['1', '2']) {
      await btn.click({ timeout: NAV_TIMEOUT_MS })
      const ok = await page
        .waitForFunction((n) => new RegExp(`Count:\\s*${n}`).test(document.body.innerText), expected, { timeout: 10_000 })
        .then(() => true)
        .catch(() => false)
      const got = (await countEl.innerText().catch(() => 'N/A')).trim()
      if (!ok || got !== expected) {
        failures.push(`after click → count = ${JSON.stringify(got)} (expected "${expected}"); the /_rsc server action did not round-trip`)
        break
      }
    }
  } finally {
    await browser.close().catch(() => {})
    proc.kill('SIGKILL')
  }

  if (failures.length > 0) {
    console.error('✗ RSC production E2E failed:')
    for (const f of failures) console.error(`    - ${f}`)
    process.exit(1)
  }
  console.log('✓ RSC production E2E passed: SSR render + "use server" action round-trip (count 0 → 1 → 2)')
}

run().catch((e) => {
  console.error(`✗ RSC production E2E errored: ${e.message}`)
  process.exit(1)
})
