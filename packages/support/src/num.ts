// ─── Num ───────────────────────────────────────────────────

const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
               'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
               'seventeen', 'eighteen', 'nineteen']
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

function spellBelow1000(n: number): string {
  if (n === 0) return ''
  if (n < 20) return ONES[n]!
  if (n < 100) {
    const t = TENS[Math.floor(n / 10)]!
    const o = n % 10
    return o === 0 ? t : `${t}-${ONES[o]}`
  }
  const h  = Math.floor(n / 100)
  const rem = n % 100
  const tail = rem === 0 ? '' : ` ${spellBelow1000(rem)}`
  return `${ONES[h]} hundred${tail}`
}

export class Num {

  /**
   * Format a number with locale-aware separators.
   * @example Num.format(1234567.89, 2) → '1,234,567.89'
   */
  static format(value: number, decimals?: number, locale = 'en-US'): string {
    return new Intl.NumberFormat(locale, {
      ...(decimals !== undefined
        ? { minimumFractionDigits: decimals, maximumFractionDigits: decimals }
        : {}),
    }).format(value)
  }

  /**
   * Format as currency.
   * @example Num.currency(9.99) → '$9.99'
   * @example Num.currency(9.99, 'EUR', 'de-DE') → '9,99 €'
   */
  static currency(value: number, currency = 'USD', locale = 'en-US'): string {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value)
  }

  /**
   * Format as a percentage. `value` is the raw number (50 = 50%, not 0.5).
   * @example Num.percentage(73.5, 1) → '73.5%'
   */
  static percentage(value: number, decimals = 0, locale = 'en-US'): string {
    return new Intl.NumberFormat(locale, {
      style:                  'percent',
      minimumFractionDigits:  decimals,
      maximumFractionDigits:  decimals,
    }).format(value / 100)
  }

  /**
   * Human-readable file size.
   * @example Num.fileSize(1536) → '1.50 KB'
   */
  static fileSize(bytes: number, precision = 2): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
    if (bytes === 0) return '0 B'
    const i   = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
    const val = bytes / Math.pow(1024, i)
    return `${val.toFixed(i === 0 ? 0 : precision)} ${units[i]}`
  }

  /**
   * Abbreviate large numbers.
   * @example Num.abbreviate(1_500_000) → '1.5M'
   */
  static abbreviate(value: number, precision = 1): string {
    const abs  = Math.abs(value)
    const sign = value < 0 ? '-' : ''
    if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(precision)}T`
    if (abs >= 1e9)  return `${sign}${(abs / 1e9).toFixed(precision)}B`
    if (abs >= 1e6)  return `${sign}${(abs / 1e6).toFixed(precision)}M`
    if (abs >= 1e3)  return `${sign}${(abs / 1e3).toFixed(precision)}K`
    return String(value)
  }

  /**
   * Ordinal suffix.
   * @example Num.ordinal(1) → '1st'
   * @example Num.ordinal(22) → '22nd'
   */
  static ordinal(value: number): string {
    const abs    = Math.abs(Math.trunc(value))
    const mod10  = abs % 10
    const mod100 = abs % 100
    if (mod100 >= 11 && mod100 <= 13) return `${value}th`
    if (mod10 === 1) return `${value}st`
    if (mod10 === 2) return `${value}nd`
    if (mod10 === 3) return `${value}rd`
    return `${value}th`
  }

  /**
   * Clamp a number within a range.
   * @example Num.clamp(150, 0, 100) → 100
   */
  static clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max)
  }

  /**
   * Remove trailing zeros after the decimal point.
   * @example Num.trim(1.5000) → '1.5'
   * @example Num.trim(1.0) → '1'
   */
  static trim(value: number, decimals?: number): string {
    if (decimals !== undefined) {
      return parseFloat(value.toFixed(decimals)).toString()
    }
    return parseFloat(value.toFixed(10)).toString()
  }

  /**
   * Spell out an integer in English words.
   * Supports integers from -(10^15 - 1) to (10^15 - 1).
   * @example Num.spell(42) → 'forty-two'
   * @example Num.spell(1001) → 'one thousand one'
   */
  static spell(value: number): string {
    const n = Math.trunc(value)
    if (n === 0) return 'zero'

    const sign = n < 0 ? 'negative ' : ''
    const abs  = Math.abs(n)

    const billions    = Math.floor(abs / 1_000_000_000)
    const millions    = Math.floor((abs % 1_000_000_000) / 1_000_000)
    const thousands   = Math.floor((abs % 1_000_000) / 1_000)
    const remainder   = abs % 1_000

    const parts: string[] = []
    if (billions)  parts.push(`${spellBelow1000(billions)} billion`)
    if (millions)  parts.push(`${spellBelow1000(millions)} million`)
    if (thousands) parts.push(`${spellBelow1000(thousands)} thousand`)
    if (remainder) parts.push(spellBelow1000(remainder))

    return sign + parts.join(' ')
  }
}
