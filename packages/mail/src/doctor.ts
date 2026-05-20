// Doctor checks contributed by @rudderjs/mail.

import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { registerDoctorCheck, type DoctorResult } from '@rudderjs/console'

function readFileSafe(rel: string): string | null {
  try { return fs.readFileSync(path.join(process.cwd(), rel), 'utf-8') } catch { return null }
}

interface SmtpHint {
  host?: string
  port?: number
}

// Pull SMTP host/port from .env hints or config/mail.ts. We deliberately
// don't import the user's config — the doctor fast-path stays boot-free
// and the user's config might pull peer modules that aren't installed.
function inferSmtp(): SmtpHint | null {
  const envHost = process.env['MAIL_HOST']     ?? process.env['SMTP_HOST']
  const envPort = process.env['MAIL_PORT']     ?? process.env['SMTP_PORT']
  if (envHost) {
    const out: SmtpHint = { host: envHost }
    if (envPort) {
      const p = Number(envPort)
      if (!Number.isNaN(p)) out.port = p
    }
    return out
  }
  const text = readFileSafe('config/mail.ts') ?? readFileSafe('config/mail.js') ?? ''
  const hostLit = /MAIL_HOST['"]?\s*,\s*['"]([^'"]+)['"]/.exec(text)?.[1]
                ?? /host\s*:\s*['"]([^'"]+)['"]/.exec(text)?.[1]
  const portLit = /MAIL_PORT['"]?\s*,\s*['"]?(\d+)/.exec(text)?.[1]
                ?? /port\s*:\s*(\d+)/.exec(text)?.[1]
  if (!hostLit) return null
  const out: SmtpHint = { host: hostLit }
  if (portLit) out.port = Number(portLit)
  return out
}

registerDoctorCheck({
  id:        'mail:smtp-connect',
  category:  'runtime',
  title:     'Mail SMTP host',
  needsBoot: true,
  run(): Promise<DoctorResult> {
    const hint = inferSmtp()
    if (!hint || !hint.host) {
      return Promise.resolve({ status: 'ok', message: 'no SMTP host configured — skip' })
    }
    // Skip the local sink that nodemailer uses for tests / preview mode
    if (/^(127\.0\.0\.1|localhost|0\.0\.0\.0)$/.test(hint.host) && (hint.port ?? 587) > 1024 && (hint.port ?? 587) < 2000) {
      // Likely a local mailpit / mailhog / preview — still try, just don't be loud
    }
    const host = hint.host
    const port = hint.port ?? 587
    return new Promise<DoctorResult>((resolve) => {
      const t0 = performance.now()
      const socket = new net.Socket()
      socket.setTimeout(2000)
      socket.once('connect', () => {
        const ms = Math.round(performance.now() - t0)
        socket.destroy()
        resolve({ status: 'ok', message: `${host}:${port} reachable in ${ms}ms` })
      })
      socket.once('timeout', () => {
        socket.destroy()
        resolve({
          status:  'warn',
          message: `${host}:${port} timed out after 2s`,
          fix:     `Verify the SMTP host is reachable from this machine (firewall, VPN, or wrong credentials)`,
        })
      })
      socket.once('error', (err: NodeJS.ErrnoException) => {
        resolve({
          status:  'error',
          message: `${host}:${port} ${err.code ?? err.message}`,
          fix:     `Verify MAIL_HOST/MAIL_PORT in .env. ${err.code === 'ENOTFOUND' ? 'DNS lookup failed.' : err.code === 'ECONNREFUSED' ? 'Nothing listening on that port.' : ''}`,
        })
      })
      socket.connect(port, host)
    })
  },
})
