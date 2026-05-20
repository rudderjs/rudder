import net from 'node:net'
import { execSync } from 'node:child_process'
import { registerDoctorCheck, type DoctorResult } from '@rudderjs/console'
import { getBootStatus } from '../boot-status.js'

// ─── runtime:app-boot ─────────────────────────────────────
//
// The boot itself happens in the doctor command's --deep handler (BEFORE
// runChecks runs); the check's only job is to surface the captured status.
// This indirection means a boot crash doesn't blow up the orchestrator —
// every subsequent runtime check still gets a chance to render, and we can
// recognize "boot didn't happen" (status = null) as a "should never see"
// signal (it'd mean the doctor command was invoked without --deep but
// someone left needsBoot on a check by mistake).

registerDoctorCheck({
  id:        'runtime:app-boot',
  category:  'runtime',
  title:     'Application bootstrap',
  needsBoot: true,
  run(): DoctorResult {
    const status = getBootStatus()
    if (!status) {
      return {
        status:  'warn',
        message: 'boot was not attempted (internal — should not see this)',
      }
    }
    if (status.ok) {
      return { status: 'ok', message: `booted in ${status.durationMs.toFixed(0)}ms` }
    }
    return {
      status:  'error',
      message: `boot threw: ${(status.error ?? '').split('\n')[0]}`,
      detail:  status.error ?? '',
      fix:     'Read the stack trace above — usually a missing env var, an unreachable service (DB / Redis / SMTP), or a provider whose dependency hasn\'t been registered. Run without `--deep` to see env/deps checks first.',
    }
  },
})

// ─── runtime:port-free ────────────────────────────────────

function portInUseHolder(port: number): string | null {
  // `lsof` is preinstalled on macOS / most Linux. The Windows equivalent is
  // `netstat -ano | findstr :3000` — we don't shell out there since this is
  // a best-effort hint and Windows users have less to gain from a PID.
  if (process.platform === 'win32') return null
  try {
    const out = execSync(`lsof -ti :${port}`, { stdio: ['ignore', 'pipe', 'ignore'], timeout: 1000 })
    const pid = out.toString().trim().split('\n')[0]
    return pid || null
  } catch {
    return null
  }
}

registerDoctorCheck({
  id:        'runtime:port-free',
  category:  'runtime',
  title:     'PORT free',
  needsBoot: true,
  async run(): Promise<DoctorResult> {
    const port = Number(process.env['PORT'] ?? 3000)
    if (Number.isNaN(port) || port < 1 || port > 65535) {
      return { status: 'warn', message: `PORT="${process.env['PORT']}" is not a valid number` }
    }
    const bound = await new Promise<{ ok: true } | { ok: false; code: string }>((resolve) => {
      const server = net.createServer()
      server.once('error', (err: NodeJS.ErrnoException) => resolve({ ok: false, code: err.code ?? 'UNKNOWN' }))
      server.once('listening', () => server.close(() => resolve({ ok: true })))
      server.listen(port, '127.0.0.1')
    })
    if (bound.ok) return { status: 'ok', message: `${port} available` }
    if (bound.code === 'EADDRINUSE') {
      const pid = portInUseHolder(port)
      const fix = pid
        ? `Stop the process: \`kill ${pid}\` (or set PORT=<other> in .env)`
        : `Set PORT=<other> in .env, or free port ${port}`
      return { status: 'error', message: `${port} in use${pid ? ` (PID ${pid})` : ''}`, fix }
    }
    return { status: 'warn', message: `bind failed: ${bound.code}` }
  },
})
