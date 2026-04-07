import type { AppRequest, AppResponse } from '@rudderjs/contracts'
import type { Aggregator, PulseStorage } from '../types.js'

/**
 * Tracks active (unique) users per minute bucket.
 * Identifies users by session cookie, auth header, or IP.
 */
export class UserAggregator implements Aggregator {
  readonly name = 'User Aggregator'
  private readonly seen = new Set<string>()
  private currentMinute = 0

  constructor(private readonly storage: PulseStorage) {}

  register(): void {
    // Middleware is registered by the service provider
  }

  middleware() {
    const storage = this.storage

    return async (req: AppRequest, _res: AppResponse, next: () => Promise<void>) => {
      // Skip static assets
      if (req.path.startsWith('/@') || (req.path.split('/').pop() ?? '').includes('.')) return next()

      const minute = Math.floor(Date.now() / 60_000)
      if (minute !== this.currentMinute) {
        this.seen.clear()
        this.currentMinute = minute
      }

      const userId = this.identifyUser(req)
      if (!this.seen.has(userId)) {
        this.seen.add(userId)
        storage.record('active_users', 1)
      }

      return next()
    }
  }

  private identifyUser(req: AppRequest): string {
    // Prefer auth user, then session, then IP
    const auth = req.headers['authorization']
    if (auth) return `auth:${auth.slice(0, 40)}`

    const cookie = req.headers['cookie'] ?? ''
    const session = cookie.match(/(?:^|;\s*)session=([^;]+)/)?.[1]
    if (session) return `session:${session}`

    return `ip:${req.headers['x-forwarded-for']?.split(',')[0]?.trim() ?? req.headers['x-real-ip'] ?? 'unknown'}`
  }
}
