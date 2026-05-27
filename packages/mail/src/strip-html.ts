/**
 * Strip HTML tags down to plain text. Used for the Markdown mail text-alternative
 * and the LogAdapter preview — both consume the result as plain text, never
 * re-render it as HTML, so this is text extraction, not a security sanitizer.
 *
 * Implemented as a single linear scan (indexOf), not a regex: a `<[^>]+>` strip
 * is polynomial ReDoS on adversarial input (`<<<<…`), and the character scan is
 * both safe and strictly more complete (no `<...>` can survive a pass).
 */
export function stripHtmlTags(html: string): string {
  let out = ''
  let i = 0
  while (i < html.length) {
    const lt = html.indexOf('<', i)
    if (lt === -1) { out += html.slice(i); break }
    out += html.slice(i, lt)
    const gt = html.indexOf('>', lt)
    if (gt === -1) break       // unterminated tag → drop the rest
    i = gt + 1
  }
  return out.replace(/\s+/g, ' ').trim()
}
