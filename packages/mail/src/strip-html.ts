/**
 * Strip HTML tags down to plain text. Used for the Markdown mail text-alternative
 * and the LogAdapter preview — both consume the result as plain text, never
 * re-render it as HTML, so this is text extraction, not a security sanitizer.
 *
 * Tags are removed iteratively until the string is stable: a single
 * `replace(/<[^>]+>/g, '')` pass can expose a new `<...>` that was hidden inside
 * another (e.g. `<<b>script>`), which CodeQL flags as
 * `incomplete-multi-character-sanitization`. Looping to a fixed point both
 * satisfies the scanner and is strictly more correct.
 */
export function stripHtmlTags(html: string): string {
  let out = html
  let prev: string
  do {
    prev = out
    out = out.replace(/<[^>]+>/g, '')
  } while (out !== prev)
  return out.replace(/\s+/g, ' ').trim()
}
