/**
 * Runtime / environment detection helpers.
 *
 * Used by config defaults to flip drivers that need raw TCP (Redis, SMTP) to
 * in-memory or HTTP equivalents when running in a sandboxed environment.
 */

/**
 * `true` when running inside a StackBlitz WebContainer — Node.js virtualized in
 * the browser via WebAssembly. WebContainers cannot open raw TCP sockets, so
 * Redis / SMTP / native Postgres drivers all fail; cache, queue, mail, and
 * session config should fall back to memory / log / cookie drivers.
 */
export function isWebContainer(): boolean {
  return !!(process.versions as Record<string, string | undefined>).webcontainer
}
