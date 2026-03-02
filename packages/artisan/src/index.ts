// ─── Artisan Registry ──────────────────────────────────────

export type ConsoleHandler = (args: string[], opts: Record<string, unknown>) => void | Promise<void>

export class CommandBuilder {
  private _description = ''

  constructor(
    readonly name:    string,
    readonly handler: ConsoleHandler,
  ) {}

  description(text: string): this {
    this._description = text
    return this
  }

  /** Alias for description() — matches Laravel's ->purpose() */
  purpose(text: string): this {
    this._description = text
    return this
  }

  getDescription(): string { return this._description }
}

export class ArtisanRegistry {
  private _commands: CommandBuilder[] = []
  private _classes:  (new () => Command)[] = []

  reset(): void {
    this._commands = []
    this._classes = []
  }

  command(name: string, handler: ConsoleHandler): CommandBuilder {
    const cmd = new CommandBuilder(name, handler)
    this._commands.push(cmd)
    return cmd
  }

  /** Register one or more class-based commands */
  register(...CommandClasses: (new () => Command)[]): void {
    this._classes.push(...CommandClasses)
  }

  getCommands(): CommandBuilder[]         { return this._commands }
  getClasses():  (new () => Command)[]    { return this._classes  }
}

// ─── Signature Parser ──────────────────────────────────────

export interface CommandArgDef {
  name:         string
  required:     boolean
  variadic:     boolean
  defaultValue?: string
}

export interface CommandOptDef {
  name:          string
  shorthand?:    string
  hasValue:      boolean
  defaultValue?: string
}

export interface ParsedSignature {
  name: string
  args: CommandArgDef[]
  opts: CommandOptDef[]
}

export function parseSignature(signature: string): ParsedSignature {
  const nameMatch = signature.match(/^([\w:.-]+)/)
  const name = nameMatch?.[1] ?? signature
  const args: CommandArgDef[] = []
  const opts: CommandOptDef[] = []

  for (const [, block] of signature.matchAll(/\{([^}]+)\}/g)) {
    // Strip inline description: {user : The user ID} → {user}
    const trimmed = block!.split(':')[0]!.trim()

    if (trimmed.startsWith('--')) {
      // Option: {--force} {--name=} {--name=default} {--N|name=}
      const inner = trimmed.slice(2)
      const eqIdx = inner.indexOf('=')
      const hasValue = eqIdx !== -1
      const namePart = hasValue ? inner.slice(0, eqIdx) : inner
      const defaultValue = hasValue ? inner.slice(eqIdx + 1) || undefined : undefined
      const parts = namePart.includes('|') ? namePart.split('|') as [string, string] : null
      const optName = parts ? parts[1] : namePart
      const shorthand = parts ? parts[0] : undefined
      const optDef: CommandOptDef = { name: optName, hasValue }
      if (shorthand)    optDef.shorthand    = shorthand
      if (defaultValue) optDef.defaultValue = defaultValue
      opts.push(optDef)
    } else {
      // Argument: {user} {user?} {user=default} {user*}
      const variadic = trimmed.endsWith('*')
      const optional = trimmed.endsWith('?')
      const raw      = trimmed.replace(/[?*]$/, '')
      const eqIdx    = raw.indexOf('=')
      const hasDefault = eqIdx !== -1
      const argName    = hasDefault ? raw.slice(0, eqIdx) : raw
      const defaultValue = hasDefault ? raw.slice(eqIdx + 1) || undefined : undefined
      const argDef: CommandArgDef = { name: argName, required: !optional && !hasDefault && !variadic, variadic }
      if (defaultValue) argDef.defaultValue = defaultValue
      args.push(argDef)
    }
  }

  return { name, args, opts }
}

// ─── Command (class-based, Laravel-style) ──────────────────

const ANSI = {
  green:  (s: string) => `\x1b[32m${s}\x1b[0m`,
  red:    (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan:   (s: string) => `\x1b[36m${s}\x1b[0m`,
  dim:    (s: string) => `\x1b[2m${s}\x1b[0m`,
}

export abstract class Command {
  abstract readonly signature:   string
  abstract readonly description: string

  private _args: Record<string, unknown> = {}
  private _opts: Record<string, unknown> = {}

  /** @internal — called by the CLI runner before handle() */
  _setContext(args: Record<string, unknown>, opts: Record<string, unknown>): void {
    this._args = args
    this._opts = opts
  }

  // ── Argument / option accessors ───────────────────────────

  argument(name: string): string {
    return String(this._args[name] ?? '')
  }

  arguments(): Record<string, unknown> {
    return { ...this._args }
  }

  option(name: string): string | boolean | undefined {
    return this._opts[name] as string | boolean | undefined
  }

  options(): Record<string, unknown> {
    return { ...this._opts }
  }

  // ── Output helpers ────────────────────────────────────────

  info(message: string):    void { console.log(ANSI.green(message))   }
  error(message: string):   void { console.error(ANSI.red(message))   }
  warn(message: string):    void { console.warn(ANSI.yellow(message)) }
  line(message = ''):       void { console.log(message)               }
  comment(message: string): void { console.log(ANSI.dim(message))     }
  newLine(count = 1):       void { console.log('\n'.repeat(count - 1)) }

  table(headers: string[], rows: string[][]): void {
    const widths = headers.map((h, i) =>
      Math.max(h.length, ...rows.map(r => (r[i] ?? '').length))
    )
    const sep = widths.map(w => '-'.repeat(w + 2)).join('+')
    const fmt = (cells: string[]) =>
      cells.map((c, i) => ` ${c.padEnd(widths[i] ?? 0)} `).join('|')
    console.log(sep)
    console.log(fmt(headers))
    console.log(sep)
    for (const row of rows) console.log(fmt(row))
    console.log(sep)
  }

  // ── Interactive prompts ───────────────────────────────────

  async ask(message: string, defaultValue?: string): Promise<string> {
    const { text, isCancel } = await import('@clack/prompts')
    const opts: Parameters<typeof text>[0] = { message }
    if (defaultValue) { opts.defaultValue = defaultValue; opts.placeholder = defaultValue }
    const result = await text(opts)
    if (isCancel(result)) { this.warn('Cancelled.'); process.exit(0) }
    return result as string
  }

  async confirm(message: string, defaultValue = false): Promise<boolean> {
    const { confirm, isCancel } = await import('@clack/prompts')
    const result = await confirm({ message, initialValue: defaultValue })
    if (isCancel(result)) { this.warn('Cancelled.'); process.exit(0) }
    return result as boolean
  }

  async choice(message: string, choices: string[], defaultValue?: string): Promise<string> {
    const { select, isCancel } = await import('@clack/prompts')
    const result = await select({
      message,
      options: choices.map(c => ({ value: c, label: c })),
      initialValue: defaultValue ?? choices[0],
    })
    if (isCancel(result)) { this.warn('Cancelled.'); process.exit(0) }
    return result as string
  }

  async secret(message: string): Promise<string> {
    const { password, isCancel } = await import('@clack/prompts')
    const result = await password({ message })
    if (isCancel(result)) { this.warn('Cancelled.'); process.exit(0) }
    return result as string
  }

  // ── Lifecycle ─────────────────────────────────────────────

  abstract handle(): void | Promise<void>
}

// ─── Global artisan singleton ──────────────────────────────

const _g = globalThis as Record<string, unknown>
if (!_g['__forge_artisan__']) _g['__forge_artisan__'] = new ArtisanRegistry()

/** Global Artisan command registry — import and call artisan.command() in routes/console.ts */
export const artisan = _g['__forge_artisan__'] as ArtisanRegistry
