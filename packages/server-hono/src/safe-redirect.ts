// ─── Open-redirect guard ───────────────────────────────────
//
// A "redirect back to the intended URL" flow (e.g. `?redirect=` after login)
// must never trust the user-supplied target — an attacker can pass an absolute
// or protocol-relative URL to bounce the victim to a phishing host. This is a
// framework-level security primitive: the only thing that matters is the shape
// of the target string, never the app's business logic.

// Control characters (NUL..US, space, DEL) plus any other raw whitespace.
// Browsers strip leading/embedded whitespace, which can smuggle a scheme/host
// past a naive prefix check (e.g. `"  //evil.com"`), so we reject it outright.
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\x00-\x20\x7f]|\s/u

/**
 * Returns `true` only when `target` is a safe same-origin redirect destination:
 * a single-leading-slash absolute path (`/dashboard`, `/`, `/a/b?x=1#y`).
 *
 * Rejected (open-redirect vectors):
 * - absolute URLs with a scheme — `https://evil.com`, `javascript:alert(1)`
 * - protocol-relative URLs — `//evil.com`
 * - backslash-smuggled variants — `/\evil.com`, `\evil.com`, `\\evil.com`
 *   (browsers normalize `\` to `/`, turning these into a host-bearing URL)
 * - anything containing control characters or raw whitespace
 */
export function isSafeRedirect(target: unknown): target is string {
  if (typeof target !== 'string' || target.length === 0) return false
  if (UNSAFE_CHARS.test(target)) return false
  // Must be an absolute path: a single leading forward slash.
  if (target[0] !== '/') return false
  // Reject protocol-relative ("//host") and backslash-smuggled ("/\\host")
  // second-character variants.
  if (target[1] === '/' || target[1] === '\\') return false
  return true
}

/**
 * Resolves a user-supplied redirect target to a safe destination, falling back
 * to `fallback` (default `'/'`) when the target fails {@link isSafeRedirect}.
 */
export function safeRedirectTarget(target: unknown, fallback = '/'): string {
  return isSafeRedirect(target) ? target : fallback
}
