import { app } from './application.js'

/**
 * Print a Vite-style `➜` line that sits with the framework's dev startup banner
 * (`➜ N providers booted`, the per-stage lines, `➜ App is ready`) and Vike's
 * own `➜ Local`/`➜ Network`. Use it from a service provider's `boot()` to log a
 * startup line in the same style instead of a bare `console.log`:
 *
 * ```ts
 * boot() {
 *   bootLine(`[AppServiceProvider] booted — app: ${this.app.name}`)
 * }
 * ```
 *
 * Dev only: in production there's no Vike banner and logs go to files /
 * aggregators, so the message is printed plain (no arrow, no ANSI) to stay
 * parseable — mirroring how the framework prints `[RudderJS] ready` in prod.
 * Safe to call before the app has fully booted (treated as non-dev).
 */
export function bootLine(message: string): void {
  let dev = false
  try { dev = app().isDevelopment() } catch { /* app not constructed yet — treat as prod */ }
  // Match the arrow the dev boot log uses: 2 spaces, green ➜, 2 spaces.
  if (dev) console.log(`  \x1b[32m➜\x1b[39m  ${message}`)
  else console.log(message)
}
