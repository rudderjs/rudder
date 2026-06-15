// Client-safe entry — re-imported via `@rudderjs/middleware/client`.
//
// The main `@rudderjs/middleware` entry pulls in server-only code
// (node:crypto, @rudderjs/cache, rate-limit machinery). Importing it
// from a browser bundle drags those server-only modules along and
// Vite externalises them, producing runtime errors when the bundle
// touches `node:crypto.randomUUID` etc.
//
// Browser code (e.g. auth form views) should import from this subpath
// instead. Only pure browser helpers belong here.

/**
 * Read the CSRF token from the browser cookie.
 * Safe to call in SSR — returns '' on the server.
 */
export function getCsrfToken(cookieName = 'csrf_token'): string {
  if (typeof (globalThis as Record<string, unknown>)['document'] === 'undefined') return ''
  const doc = (globalThis as Record<string, unknown>)['document'] as { cookie: string }
  // Escape regex metacharacters so a custom cookieName like `csrf.token` matches
  // literally (the server reads it with an exact key lookup). Without this the
  // `.` is a wildcard and could read an unrelated `csrfXtoken` cookie.
  const safe = cookieName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = doc.cookie.match(new RegExp(`(?:^|;\\s*)${safe}=([^;]+)`))
  return match?.[1] ? decodeURIComponent(match[1]) : ''
}
