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
 * Rendered "muted" — a dim green arrow + dim text with the leading word bold as
 * a label — matching Vike's secondary banner lines (`➜ Network`, `➜ press h`),
 * since a provider boot notice is secondary to the URLs above it.
 *
 * Dev only: in production there's no Vike banner and logs go to files /
 * aggregators, so the message is printed plain (no arrow, no ANSI) to stay
 * parseable — mirroring how the framework prints `[RudderJS] ready` in prod.
 * Safe to call before the app has fully booted (treated as non-dev).
 */
export function bootLine(message: string): void {
  let dev = false
  try { dev = app().isDevelopment() } catch { /* app not constructed yet — treat as prod */ }
  if (!dev) { console.log(message); return }
  // Bold the leading word as a label; dim the rest. `\x1b[22m` clears bold+dim
  // together, so re-open dim (`\x1b[2m`) for the remainder.
  const sp    = message.indexOf(' ')
  const label = sp === -1 ? message : message.slice(0, sp)
  const rest  = sp === -1 ? '' : message.slice(sp)
  // Dim green arrow (dim stays on), bold+dim label, dim rest.
  console.log(`  \x1b[2m\x1b[32m➜\x1b[39m  \x1b[1m${label}\x1b[22m\x1b[2m${rest}\x1b[0m`)
}
