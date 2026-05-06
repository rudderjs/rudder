/**
 * Constant-time string comparison.
 *
 * Used on every site that compares a hashed credential or a verifier:
 * client secret hashes (hex), PKCE verifier ↔ challenge (base64url for
 * S256, raw for plain). `===` / `!==` short-circuits on first mismatch,
 * leaking timing on pathological inputs; `timingSafeEqual` runs in O(n)
 * regardless of where the first mismatch falls.
 *
 * Returns `false` for any null/undefined input or length mismatch — both
 * surface as authentication failures upstream, no need to throw.
 *
 * `node:crypto` is lazy-loaded so this module is safe to import from
 * package entrypoints (matches the rest of @rudderjs/passport's lazy
 * crypto pattern; Vite externalizes node:* and a top-level import crashes
 * the browser).
 */
export async function safeCompare(a: string | null | undefined, b: string | null | undefined): Promise<boolean> {
  if (a == null || b == null) return false
  if (a.length !== b.length)  return false
  const { timingSafeEqual } = await import('node:crypto')
  // UTF-8 bytes — works for any ASCII encoding (hex, base64url) and length
  // checks above guarantee Buffer.byteLength matches for these inputs.
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
}
