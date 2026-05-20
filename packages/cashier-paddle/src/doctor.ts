// Doctor checks contributed by @rudderjs/cashier-paddle.

import fs from 'node:fs'
import path from 'node:path'
import { registerDoctorCheck, type DoctorResult } from '@rudderjs/console'

function readFileSafe(rel: string): string | null {
  try { return fs.readFileSync(path.join(process.cwd(), rel), 'utf-8') } catch { return null }
}

// Cashier provides routes via `registerCashierRoutes()` — most apps that
// install the package wire it up in routes/web.ts or routes/api.ts. We
// detect the wire-up by grepping the route files, which avoids booting
// the app on the fast-path.
function cashierWiredUp(): boolean {
  for (const rel of ['routes/web.ts', 'routes/api.ts']) {
    const text = readFileSafe(rel)
    if (text && /registerCashierRoutes|paddle\/webhook|CashierController/.test(text)) {
      return true
    }
  }
  return false
}

registerDoctorCheck({
  id:       'cashier-paddle:api-key',
  category: 'billing',
  title:    'PADDLE_API_KEY',
  run(): DoctorResult {
    if (!cashierWiredUp()) {
      return { status: 'ok', message: 'no cashier routes mounted — skip' }
    }
    const v = process.env['PADDLE_API_KEY']
    if (!v) {
      return {
        status:  'error',
        message: 'unset',
        fix:     'Add PADDLE_API_KEY to .env (Paddle Dashboard → Developer Tools → Authentication)',
      }
    }
    // Paddle keys are typically 40+ chars; flag suspiciously short values
    if (v.length < 20) {
      return { status: 'warn', message: `set but suspiciously short (${v.length} chars)` }
    }
    return { status: 'ok', message: 'set' }
  },
})

registerDoctorCheck({
  id:       'cashier-paddle:webhook-secret',
  category: 'billing',
  title:    'PADDLE_WEBHOOK_SECRET',
  run(): DoctorResult {
    if (!cashierWiredUp()) {
      return { status: 'ok', message: 'no cashier routes mounted — skip' }
    }
    const v = process.env['PADDLE_WEBHOOK_SECRET']
    if (!v) {
      return {
        status:  'error',
        message: 'unset — webhook verification will fail',
        fix:     'Add PADDLE_WEBHOOK_SECRET to .env (Paddle Dashboard → Developer Tools → Notifications → Webhook secret)',
      }
    }
    if (v.length < 16) {
      return { status: 'warn', message: `set but only ${v.length} chars` }
    }
    return { status: 'ok', message: 'set' }
  },
})
