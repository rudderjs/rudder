import type { Mailable } from './mailable.js'
import type { MailAdapter, SendOptions } from './index.js'

// ─── FailoverAdapter ────────────────────────────────────────

/**
 * Tries mailers in order — if the first fails, falls back to the next.
 * All configured mailers must fail before the send is considered a failure.
 *
 * **Retry-window contract.** A mailer that fails is marked in
 * `_lastFailures` with the failure timestamp and skipped for the next
 * `retryAfter` seconds **on every send**, regardless of the underlying
 * issue resolving. Failures are not auto-cleared by a subsequent success
 * (a different mailer succeeding doesn't reset the failed mailer's
 * timestamp). This is intended backoff, not a bug — but it means a single
 * transient error gates that mailer for the entire window. To force a
 * recheck, restart the process or construct a new `FailoverAdapter`.
 *
 * @example
 * // In config/mail.ts:
 * mailers: {
 *   failover: {
 *     driver: 'failover',
 *     mailers: ['smtp', 'ses', 'log'],
 *     retryAfter: 60, // seconds before retrying a failed mailer
 *   },
 *   smtp: { driver: 'smtp', host: '...', port: 587 },
 *   ses: { driver: 'smtp', host: 'email-smtp.us-east-1.amazonaws.com', ... },
 * }
 */
export class FailoverAdapter implements MailAdapter {
  private _lastFailures = new Map<number, number>()

  constructor(
    private readonly _adapters: MailAdapter[],
    private readonly _retryAfter = 60,
  ) {}

  async send(mailable: Mailable, options: SendOptions): Promise<void> {
    const errors: Error[] = []
    const now = Date.now()

    for (let i = 0; i < this._adapters.length; i++) {
      // Skip adapters that recently failed (within retryAfter window)
      const lastFailure = this._lastFailures.get(i)
      if (lastFailure !== undefined && now - lastFailure < this._retryAfter * 1000) {
        continue
      }

      try {
        await this._adapters[i]!.send(mailable, options)
        return // success
      } catch (err) {
        this._lastFailures.set(i, now)
        errors.push(err instanceof Error ? err : new Error(String(err)))
      }
    }

    throw new Error(
      `[RudderJS Mail] All mailers failed.\n` +
      errors.map((e, i) => `  Mailer ${i}: ${e.message}`).join('\n')
    )
  }
}
