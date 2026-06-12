import type { MiddlewareHandler } from '@rudderjs/contracts'
import { Cashier } from '../Cashier.js'

/**
 * Verify Paddle's `Paddle-Signature` header — HMAC-SHA256 of `<ts>:<body>`
 * keyed by `Cashier.webhookSecret()`. Format documented at:
 *   https://developer.paddle.com/webhooks/respond-to-webhooks#verify-signature
 *
 * Header looks like: `ts=1700000000;h1=hex-digest[;h1=alt-digest...]`
 *
 * We accept any `h1` digest match (Paddle ships multiple during key rotation).
 *
 * Requires `captureRawBody()` to have run first.
 */
export function verifyPaddleWebhook(): MiddlewareHandler {
  return async function verifyPaddleWebhook(req, res, next) {
    const secret = Cashier.webhookSecret()
    if (!secret) {
      // No secret configured — fail closed. Mis-configuration is a bug, not
      // a "let everything through" condition.
      res.status(500).json({ error: 'webhook_secret_not_configured' })
      return
    }

    const raw = req.raw as { __rjs_paddle_raw_body?: string; headers?: Record<string, string>; request?: Request }
    const body = raw.__rjs_paddle_raw_body ?? ''

    const sigHeader = readHeader(req, 'paddle-signature')
    if (!sigHeader) {
      res.status(400).json({ error: 'missing_signature' })
      return
    }

    const parsed = parseSignature(sigHeader)
    if (!parsed) {
      res.status(400).json({ error: 'malformed_signature' })
      return
    }

    const { crypto } = await import('node:crypto').then((m) => ({ crypto: m }))
    const signed = `${parsed.ts}:${body}`
    const expected = crypto.createHmac('sha256', secret).update(signed).digest('hex')

    const ok = parsed.signatures.some((sig) => timingSafeEqualHex(sig, expected))
    if (!ok) {
      res.status(401).json({ error: 'invalid_signature' })
      return
    }

    // Replay guard. `parsed.ts` is part of the signed payload, so a forged
    // request can't reach here — this rejects an AUTHENTIC request replayed
    // outside the tolerance window. Disabled when tolerance is 0.
    const tolerance = Cashier.webhookTolerance()
    if (tolerance > 0) {
      const tsSeconds  = Number(parsed.ts)
      const nowSeconds = Date.now() / 1000
      if (!Number.isFinite(tsSeconds) || Math.abs(nowSeconds - tsSeconds) > tolerance) {
        res.status(403).json({ error: 'timestamp_out_of_tolerance' })
        return
      }
    }

    await next()
  }
}

// ─── Helpers ──────────────────────────────────────────────

function readHeader(req: unknown, name: string): string | null {
  const r = req as { headers?: Record<string, string | string[] | undefined>; raw?: { headers?: Record<string, string>; request?: Request } }
  const lower = name.toLowerCase()
  if (r.headers) {
    for (const [k, v] of Object.entries(r.headers)) {
      if (k.toLowerCase() === lower) {
        return Array.isArray(v) ? (v[0] ?? null) : (v ?? null)
      }
    }
  }
  const webReq = r.raw?.request
  if (webReq?.headers && typeof (webReq.headers as Headers).get === 'function') {
    return (webReq.headers as Headers).get(name)
  }
  return null
}

function parseSignature(header: string): { ts: string; signatures: string[] } | null {
  const parts = header.split(';').map((p) => p.trim())
  let ts = ''
  const sigs: string[] = []
  for (const part of parts) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const key = part.slice(0, eq)
    const val = part.slice(eq + 1)
    if (key === 'ts') ts = val
    if (key === 'h1') sigs.push(val)
  }
  if (!ts || sigs.length === 0) return null
  return { ts, signatures: sigs }
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}
