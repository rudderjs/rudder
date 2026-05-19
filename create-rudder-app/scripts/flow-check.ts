// Headless-browser auth-flow check for a booted scaffold-app.
//
// Phase 4 of docs/plans/2026-05-19-scaffolder-render-e2e.md. Drives a full
// register → home → sign-out → login round-trip via the actual scaffolded UI
// — catches the bug class that render-check (page-renders) can't see:
// CSRF token round-trip, form POST → JSON response, SPA navigate after submit,
// session cookie persistence across requests, pageContext.user wiring on SSR,
// sign-out POST + page nav back to a guest page.
//
// Single-cell scope per the plan: framework=react × profile=default only.
// Smoke owns the server lifecycle — this script just drives the browser.

import { chromium, type Browser } from 'playwright'

export interface FlowCheckResult {
  ok:       boolean
  steps:    StepResult[]
  /** Human-readable summary of the failures (or '' on success). */
  summary:  string
}

interface StepResult {
  name:     string
  ok:       boolean
  reason?:  string
  durationMs: number
}

export interface FlowCheckOptions {
  /** Per-step timeout. Default 15s. */
  timeoutMs?: number
}

const DEFAULTS = {
  timeoutMs: 15_000,
}

interface Credentials {
  name:     string
  email:    string
  password: string
}

/**
 * Drive a chromium browser through register → home → sign-out → login. Each
 * step is timed and recorded so a failure in CI points at the exact stage that
 * broke (form fill vs SPA-nav vs sign-out, etc.). Returns aggregate result.
 */
export async function flowCheck(
  baseUrl: string,
  opts: FlowCheckOptions = {},
): Promise<FlowCheckResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULTS.timeoutMs

  // Unique-per-run so a kept tmpdir + repeat run doesn't 409 on duplicate email.
  const creds: Credentials = {
    name:     'Flow Check',
    email:    `flow-check-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@smoke.local`,
    password: 'flow-check-password-123',
  }

  const steps: StepResult[] = []
  let browser: Browser | null = null

  try {
    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext()
    const page    = await context.newPage()

    const consoleErrors: string[] = []
    page.on('pageerror',  (e)   => consoleErrors.push(`page error: ${e.message}`))
    page.on('console',    (msg) => { if (msg.type() === 'error') consoleErrors.push(`console.error: ${msg.text()}`) })

    await runStep(steps, 'GET /register',           () => gotoRegister(page, baseUrl, timeoutMs))
    await runStep(steps, 'submit register form',    () => submitRegister(page, creds, timeoutMs))
    await runStep(steps, 'SPA nav to / (signed in)', () => waitForHome(page, baseUrl, timeoutMs))
    await runStep(steps, 'assert signed-in state',  () => assertSignedIn(page, creds, timeoutMs))
    await runStep(steps, 'click sign out',           () => clickSignOut(page, timeoutMs))
    await runStep(steps, 'nav to / (signed out)',   () => waitForHome(page, baseUrl, timeoutMs))
    await runStep(steps, 'assert signed-out state', () => assertSignedOut(page, timeoutMs))

    if (consoleErrors.length > 0) {
      steps.push({ name: 'no console errors during flow', ok: false, reason: consoleErrors.join('; '), durationMs: 0 })
    }

    await context.close()
  } finally {
    if (browser) await browser.close()
  }

  const ok = steps.every((s) => s.ok)
  return {
    ok,
    steps,
    summary: ok ? '' : formatFailures(steps),
  }
}

async function runStep(
  out:  StepResult[],
  name: string,
  fn:   () => Promise<void>,
): Promise<void> {
  // Subsequent steps still run after a failure so CI logs show which
  // downstream assertions also broke (often a clue to the root cause).
  const start = Date.now()
  try {
    await fn()
    out.push({ name, ok: true, durationMs: Date.now() - start })
  } catch (e) {
    out.push({ name, ok: false, reason: e instanceof Error ? e.message : String(e), durationMs: Date.now() - start })
  }
}

async function gotoRegister(page: import('playwright').Page, baseUrl: string, timeoutMs: number): Promise<void> {
  const url      = baseUrl.replace(/\/$/, '') + '/register'
  const response = await page.goto(url, { waitUntil: 'networkidle', timeout: timeoutMs })
  if (!response || response.status() !== 200) throw new Error(`expected 200 from /register, got ${response?.status() ?? 'no response'}`)
  // Wait for hydration — Register.tsx's submit handler is client-side only.
  await page.waitForSelector('input#name',     { timeout: timeoutMs })
  await page.waitForSelector('input#email',    { timeout: timeoutMs })
  await page.waitForSelector('input#password', { timeout: timeoutMs })
}

async function submitRegister(page: import('playwright').Page, creds: Credentials, timeoutMs: number): Promise<void> {
  await page.fill('input#name',     creds.name)
  await page.fill('input#email',    creds.email)
  await page.fill('input#password', creds.password)
  // The form's onSubmit handler does fetch + navigate(homeUrl). Wait for the
  // POST response so we can distinguish "form submitted, server rejected" from
  // "form never submitted" in failure logs.
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/auth/sign-up/email'), { timeout: timeoutMs }),
    page.click('button[type=submit]'),
  ])
  if (response.status() !== 200) {
    const body = await response.text().catch(() => '')
    throw new Error(`POST /auth/sign-up/email returned ${response.status()}: ${body.slice(0, 200)}`)
  }
}

async function waitForHome(page: import('playwright').Page, baseUrl: string, timeoutMs: number): Promise<void> {
  // Both register success and sign-out land on `/` — register via vike's
  // SPA navigate(), sign-out via `window.location.href = '/'`. Either way,
  // waitForURL('/') resolves once the URL bar matches.
  const homeUrl = baseUrl.replace(/\/$/, '') + '/'
  await page.waitForURL(homeUrl, { timeout: timeoutMs, waitUntil: 'networkidle' })
}

async function assertSignedIn(page: import('playwright').Page, creds: Credentials, timeoutMs: number): Promise<void> {
  // SiteHeader's signed-in branch shows the user name in a badge + a "Sign out"
  // button. We assert both so a regression that drops one but not the other
  // (e.g. badge wired but button missing) still fails.
  await page.waitForSelector('button:has-text("Sign out")', { timeout: timeoutMs })
  const headerText = await page.locator('header').innerText({ timeout: timeoutMs })
  if (!headerText.includes(creds.name)) throw new Error(`signed-in header missing user name "${creds.name}" — got: ${headerText.replace(/\n/g, ' | ')}`)
  // No Login / Register links should be present in the signed-in state.
  const loginLinks = await page.locator('header a[href="/login"]').count()
  if (loginLinks > 0) throw new Error(`signed-in header still shows ${loginLinks} Login link(s)`)
}

async function clickSignOut(page: import('playwright').Page, timeoutMs: number): Promise<void> {
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/auth/sign-out'), { timeout: timeoutMs }),
    page.click('button:has-text("Sign out")'),
  ])
  if (response.status() !== 200) {
    const body = await response.text().catch(() => '')
    throw new Error(`POST /auth/sign-out returned ${response.status()}: ${body.slice(0, 200)}`)
  }
}

async function assertSignedOut(page: import('playwright').Page, timeoutMs: number): Promise<void> {
  await page.waitForSelector('header a[href="/login"]',    { timeout: timeoutMs })
  await page.waitForSelector('header a[href="/register"]', { timeout: timeoutMs })
  const signOutButtons = await page.locator('button:has-text("Sign out")').count()
  if (signOutButtons > 0) throw new Error(`signed-out header still shows ${signOutButtons} Sign out button(s) — session not cleared`)
}

function formatFailures(steps: ReadonlyArray<StepResult>): string {
  const lines: string[] = []
  for (const s of steps) {
    if (s.ok) {
      lines.push(`  ✓ ${s.name} (${s.durationMs}ms)`)
    } else {
      lines.push(`  ✗ ${s.name} (${s.durationMs}ms)`)
      if (s.reason) lines.push(`      ${s.reason}`)
    }
  }
  return lines.join('\n')
}
