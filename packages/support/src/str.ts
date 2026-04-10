// ─── Str ───────────────────────────────────────────────────

export class Str {

  // ── Case conversion ─────────────────────────────────────

  /** Convert to camelCase. */
  static camel(value: string): string {
    return value
      .replace(/[-_\s]+(.)/g, (_, c: string) => c.toUpperCase())
      .replace(/^(.)/, c => c.toLowerCase())
  }

  /** Convert to snake_case. */
  static snake(value: string): string {
    return value
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
      .replace(/([a-z\d])([A-Z])/g, '$1_$2')
      .replace(/[-\s]+/g, '_')
      .toLowerCase()
      .replace(/^_/, '')
  }

  /** Convert to kebab-case. */
  static kebab(value: string): string {
    return Str.snake(value).replace(/_/g, '-')
  }

  /** Convert to StudlyCase (PascalCase). */
  static studly(value: string): string {
    return value
      .replace(/[-_\s]+(.)/g, (_, c: string) => c.toUpperCase())
      .replace(/^(.)/, c => c.toUpperCase())
  }

  /** Convert to Title Case (each word capitalised). */
  static title(value: string): string {
    return value.replace(/\b\w/g, c => c.toUpperCase())
  }

  /**
   * Convert snake_case, kebab-case, or camelCase to a human-readable headline.
   * @example Str.headline('user_profile') → 'User Profile'
   */
  static headline(value: string): string {
    const words = value
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .replace(/([a-z\d])([A-Z])/g, '$1 $2')
      .replace(/[-_]+/g, ' ')
      .trim()
      .split(/\s+/)
    return words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
  }

  // ── Truncation ──────────────────────────────────────────

  /** Limit string to `limit` characters. */
  static limit(value: string, limit = 100, end = '...'): string {
    if (value.length <= limit) return value
    return value.slice(0, limit) + end
  }

  /** Limit to `words` words. */
  static words(value: string, words = 100, end = '...'): string {
    const arr = value.split(/\s+/)
    if (arr.length <= words) return value
    return arr.slice(0, words).join(' ') + end
  }

  /**
   * Extract a short excerpt around a search phrase.
   * @example Str.excerpt('The quick brown fox', 'quick', { radius: 5 }) → '...The quick brown...'
   */
  static excerpt(value: string, phrase: string, options: { radius?: number; omission?: string } = {}): string {
    const radius   = options.radius   ?? 100
    const omission = options.omission ?? '...'
    const idx      = value.toLowerCase().indexOf(phrase.toLowerCase())
    if (idx === -1) return value.slice(0, radius * 2) + (value.length > radius * 2 ? omission : '')
    const start  = Math.max(0, idx - radius)
    const end    = Math.min(value.length, idx + phrase.length + radius)
    const prefix = start > 0 ? omission : ''
    const suffix = end < value.length ? omission : ''
    return prefix + value.slice(start, end) + suffix
  }

  // ── Search ──────────────────────────────────────────────

  /** True if value contains any of the needles. */
  static contains(value: string, needles: string | string[]): boolean {
    const arr = Array.isArray(needles) ? needles : [needles]
    return arr.some(n => value.includes(n))
  }

  /** True if value contains all needles. */
  static containsAll(value: string, needles: string[]): boolean {
    return needles.every(n => value.includes(n))
  }

  /** True if value starts with any of the needles. */
  static startsWith(value: string, needles: string | string[]): boolean {
    const arr = Array.isArray(needles) ? needles : [needles]
    return arr.some(n => value.startsWith(n))
  }

  /** True if value ends with any of the needles. */
  static endsWith(value: string, needles: string | string[]): boolean {
    const arr = Array.isArray(needles) ? needles : [needles]
    return arr.some(n => value.endsWith(n))
  }

  // ── Extraction ──────────────────────────────────────────

  /** Everything before the first occurrence of `search`. */
  static before(value: string, search: string): string {
    const idx = value.indexOf(search)
    return idx === -1 ? value : value.slice(0, idx)
  }

  /** Everything before the last occurrence of `search`. */
  static beforeLast(value: string, search: string): string {
    const idx = value.lastIndexOf(search)
    return idx === -1 ? value : value.slice(0, idx)
  }

  /** Everything after the first occurrence of `search`. */
  static after(value: string, search: string): string {
    const idx = value.indexOf(search)
    return idx === -1 ? value : value.slice(idx + search.length)
  }

  /** Everything after the last occurrence of `search`. */
  static afterLast(value: string, search: string): string {
    const idx = value.lastIndexOf(search)
    return idx === -1 ? value : value.slice(idx + search.length)
  }

  /** Everything between `from` and the first `to`. */
  static between(value: string, from: string, to: string): string {
    return Str.before(Str.after(value, from), to)
  }

  // ── Replacement ─────────────────────────────────────────

  /** Replace the first occurrence of `search` with `replace`. */
  static replaceFirst(value: string, search: string, replace: string): string {
    const idx = value.indexOf(search)
    return idx === -1 ? value : value.slice(0, idx) + replace + value.slice(idx + search.length)
  }

  /** Replace the last occurrence of `search` with `replace`. */
  static replaceLast(value: string, search: string, replace: string): string {
    const idx = value.lastIndexOf(search)
    return idx === -1 ? value : value.slice(0, idx) + replace + value.slice(idx + search.length)
  }

  // ── Padding ─────────────────────────────────────────────

  /** Pad the left side. */
  static padLeft(value: string, length: number, pad = ' '): string {
    return value.padStart(length, pad)
  }

  /** Pad the right side. */
  static padRight(value: string, length: number, pad = ' '): string {
    return value.padEnd(length, pad)
  }

  /** Pad both sides (centres the string). */
  static padBoth(value: string, length: number, pad = ' '): string {
    const total = length - value.length
    if (total <= 0) return value
    const left = Math.floor(total / 2)
    const right = total - left
    return pad.repeat(Math.ceil(left / pad.length)).slice(0, left)
      + value
      + pad.repeat(Math.ceil(right / pad.length)).slice(0, right)
  }

  // ── Whitespace ──────────────────────────────────────────

  /** Collapse all whitespace runs to a single space and trim. */
  static squish(value: string): string {
    return value.trim().replace(/\s+/g, ' ')
  }

  /**
   * Trim the string. If `chars` is provided, trims those characters instead of whitespace.
   * @example Str.trim('/path/', '/') → 'path'
   */
  static trim(value: string, chars?: string): string {
    if (!chars) return value.trim()
    const escaped = chars.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')
    return value.replace(new RegExp(`^[${escaped}]+|[${escaped}]+$`, 'g'), '')
  }

  // ── Masking & Security ──────────────────────────────────

  /**
   * Mask a portion of the string.
   * @example Str.mask('john@example.com', '*', 4) → 'john*************'
   * @example Str.mask('4111 1111 1111 1111', '*', 0, 14) → '************** 1111'
   */
  static mask(value: string, char = '*', start = 0, length?: number): string {
    const end = length !== undefined ? start + length : value.length
    return value.split('').map((c, i) => (i >= start && i < end ? char : c)).join('')
  }

  // ── Encoding / Normalisation ────────────────────────────

  /** Strip diacritics and non-ASCII characters. */
  static ascii(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\u0000-\u007F]/g, '') // eslint-disable-line no-control-regex
  }

  /**
   * Convert to a URL-friendly slug.
   * @example Str.slug('Hello World!') → 'hello-world'
   */
  static slug(value: string, separator = '-'): string {
    return Str.ascii(value)
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/[\s-]+/g, separator)
  }

  // ── Identification ──────────────────────────────────────

  /** Generate a UUID v4. */
  static uuid(): string {
    return crypto.randomUUID()
  }

  /** True if value is a valid UUID v4 (any variant). */
  static isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  }

  /** True if value is a valid ULID. */
  static isUlid(value: string): boolean {
    return /^[0-9A-HJKMNP-TV-Z]{26}$/i.test(value)
  }

  // ── Generation ──────────────────────────────────────────

  /** Generate a cryptographically-random alphanumeric string. */
  static random(length = 16): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    const bytes = crypto.getRandomValues(new Uint8Array(length))
    return Array.from(bytes, b => chars[b % chars.length]!).join('')
  }

  /** Generate a cryptographically-random password. */
  static password(length = 32, symbols = true): string {
    const alpha  = 'abcdefghijklmnopqrstuvwxyz'
    const upper  = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    const digits = '0123456789'
    const syms   = '!@#$%^&*()_+-=[]{}|;:,.<>?'
    const chars  = alpha + upper + digits + (symbols ? syms : '')
    const bytes  = crypto.getRandomValues(new Uint8Array(length))
    return Array.from(bytes, b => chars[b % chars.length]!).join('')
  }

  // ── Pluralisation ───────────────────────────────────────

  /**
   * Pluralise an English word.
   * @example Str.plural('post') → 'posts'
   * @example Str.plural('post', 1) → 'post'
   */
  static plural(value: string, count = 2): string {
    if (Math.abs(count) === 1) return value
    const lower = value.toLowerCase()

    // Irregular
    const irregulars: Record<string, string> = {
      person: 'people', man: 'men', woman: 'women', child: 'children',
      tooth: 'teeth', foot: 'feet', goose: 'geese', mouse: 'mice',
      ox: 'oxen', leaf: 'leaves', life: 'lives', knife: 'knives',
      wolf: 'wolves', half: 'halves', self: 'selves', elf: 'elves',
      shelf: 'shelves', loaf: 'loaves', potato: 'potatoes', tomato: 'tomatoes',
      echo: 'echoes', hero: 'heroes', veto: 'vetoes',
    }
    if (lower in irregulars) {
      const p = irregulars[lower]!
      return value === value.toUpperCase() ? p.toUpperCase() : value[0] === value[0]?.toUpperCase() ? Str.title(p) : p
    }

    // Uncountable
    const uncountable = ['sheep', 'fish', 'deer', 'species', 'aircraft', 'news', 'series', 'feedback', 'staff', 'equipment', 'information', 'rice', 'money', 'police']
    if (uncountable.includes(lower)) return value

    // Rules
    if (/(?:s|x|z|ch|sh)$/i.test(value)) return value + 'es'
    if (/[^aeiou]y$/i.test(value)) return value.slice(0, -1) + 'ies'
    if (/(?:[^aeiou])o$/i.test(value)) return value + 'es'
    if (/(?:f)$/i.test(value)) return value.slice(0, -1) + 'ves'
    if (/(?:fe)$/i.test(value)) return value.slice(0, -2) + 'ves'
    return value + 's'
  }

  /**
   * Singularise an English word.
   * @example Str.singular('posts') → 'post'
   */
  static singular(value: string): string {
    const lower = value.toLowerCase()

    // Irregular (reverse lookup)
    const irregulars: Record<string, string> = {
      people: 'person', men: 'man', women: 'woman', children: 'child',
      teeth: 'tooth', feet: 'foot', geese: 'goose', mice: 'mouse',
      oxen: 'ox', leaves: 'leaf', lives: 'life', knives: 'knife',
      wolves: 'wolf', halves: 'half', selves: 'self', elves: 'elf',
      shelves: 'shelf', loaves: 'loaf', potatoes: 'potato', tomatoes: 'tomato',
      echoes: 'echo', heroes: 'hero', vetoes: 'veto',
    }
    if (lower in irregulars) return irregulars[lower]!

    // Uncountable
    const uncountable = ['sheep', 'fish', 'deer', 'species', 'aircraft', 'news', 'series', 'feedback', 'staff', 'equipment', 'information', 'rice', 'money', 'police']
    if (uncountable.includes(lower)) return value

    if (/ies$/i.test(value)) return value.slice(0, -3) + 'y'
    if (/ves$/i.test(value)) return value.slice(0, -3) + 'f'
    if (/(?:s|x|z|ch|sh)es$/i.test(value)) return value.slice(0, -2)
    if (/oes$/i.test(value)) return value.slice(0, -2)
    if (/s$/i.test(value) && !/ss$/i.test(value)) return value.slice(0, -1)
    return value
  }
}
