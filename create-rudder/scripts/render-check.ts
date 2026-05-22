// Headless-browser render check for a booted scaffold-app.
//
// Phase 1 + 2 of docs/plans/2026-05-19-scaffolder-render-e2e.md.
// Driven by smoke.ts after `pnpm build` + boot succeeded. For each URL in the
// profile route manifest, navigates a chromium page, asserts a 200, optionally
// asserts an SSR marker is in the HTML, and fails on any browser-side error
// (page error, console.error). Catches hydration failures that the SSR-only
// smoke can't see.
//
// Smoke owns the server lifecycle — this script just drives the browser.

import { chromium, type Browser, type Page } from 'playwright'
import type { RouteSpec } from '../src/templates/routes-manifest.js'

export interface RenderCheckResult {
  ok:        boolean
  routesHit: number
  failures:  RouteFailure[]
  /** Human-readable summary of the failures (or '' on success). */
  summary:   string
}

export interface RouteFailure {
  route:        RouteSpec
  reasons:      string[]
}

export interface RenderCheckOptions {
  /** Per-route navigation timeout. Default 15s. */
  timeoutMs?:        number
  /**
   * Console message types that should be treated as failures. Defaults to
   * ['error'] — warnings are noisy on dev-mode framework boot. We boot the
   * smoke in production (`NODE_ENV=production`, `node dist/server/index.mjs`)
   * so even 'warning' could be flipped on later, but staying conservative
   * for v1.
   */
  failOnConsole?:    ReadonlyArray<'error' | 'warning'>
  /**
   * Wait condition for page.goto(). 'networkidle' is the safest signal that
   * hydration is past the initial request burst but can hang on long-poll /
   * SSE / WS endpoints (e.g. /telescope's SSE stream). Smoke runs in prod mode
   * so HMR + Vite dev-server pings are gone, but if a real long-poll appears
   * here we'll need to drop to 'domcontentloaded'.
   */
  waitUntil?:        'load' | 'domcontentloaded' | 'networkidle'
}

const DEFAULTS = {
  timeoutMs:     15_000,
  failOnConsole: ['error'] as const,
  waitUntil:     'networkidle' as const,
}

/**
 * Drive a chromium browser through the given routes, fail-collecting per-route
 * so one broken page doesn't abort the suite. Returns aggregate result with
 * enough detail to print the offending console/page-error text in CI.
 */
export async function renderCheck(
  baseUrl: string,
  routes: ReadonlyArray<RouteSpec>,
  opts: RenderCheckOptions = {},
): Promise<RenderCheckResult> {
  const timeoutMs     = opts.timeoutMs     ?? DEFAULTS.timeoutMs
  const failOnConsole = opts.failOnConsole ?? DEFAULTS.failOnConsole
  const waitUntil     = opts.waitUntil     ?? DEFAULTS.waitUntil

  let browser: Browser | null = null
  const failures: RouteFailure[] = []

  try {
    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext()

    for (const route of routes) {
      const failure = await checkRoute(context.newPage(), baseUrl, route, {
        timeoutMs, failOnConsole, waitUntil,
      })
      if (failure) failures.push(failure)
    }

    await context.close()
  } finally {
    if (browser) await browser.close()
  }

  const ok = failures.length === 0
  return {
    ok,
    routesHit: routes.length,
    failures,
    summary:   ok ? '' : formatFailures(failures),
  }
}

async function checkRoute(
  pagePromise: Promise<Page> | Page,
  baseUrl: string,
  route: RouteSpec,
  opts: Required<Pick<RenderCheckOptions, 'timeoutMs' | 'waitUntil'>> & { failOnConsole: ReadonlyArray<'error' | 'warning'> },
): Promise<RouteFailure | null> {
  const page = await pagePromise
  const reasons: string[] = []

  // Wire listeners BEFORE goto so we don't miss boot-time messages.
  page.on('pageerror', (e) => {
    reasons.push(`page error: ${e.message}`)
  })
  page.on('console', (msg) => {
    if (!opts.failOnConsole.includes(msg.type() as 'error' | 'warning')) return
    reasons.push(`console.${msg.type()}: ${msg.text()}`)
  })

  try {
    const url = baseUrl.replace(/\/$/, '') + route.path
    const expectedStatus = route.expectedStatus ?? 200
    const response = await page.goto(url, { waitUntil: opts.waitUntil, timeout: opts.timeoutMs })

    if (!response) {
      reasons.push(`no response from ${url}`)
    } else if (response.status() !== expectedStatus) {
      reasons.push(`HTTP ${response.status()} (expected ${expectedStatus})`)
    }

    if (response && response.status() === expectedStatus && route.ssrMarker) {
      const html = await response.text()
      if (!html.includes(route.ssrMarker)) {
        reasons.push(`SSR marker "${route.ssrMarker}" missing from body (got ${html.length} bytes)`)
      }
    }
  } catch (e) {
    reasons.push(`navigation threw: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    await page.close()
  }

  return reasons.length > 0 ? { route, reasons } : null
}

function formatFailures(failures: ReadonlyArray<RouteFailure>): string {
  const lines: string[] = []
  for (const f of failures) {
    lines.push(`  ✗ ${f.route.path} (from ${f.route.contributedBy}):`)
    for (const r of f.reasons) lines.push(`      - ${r}`)
  }
  return lines.join('\n')
}
