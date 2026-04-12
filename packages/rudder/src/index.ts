// ─── Cancelled Error ───────────────────────────────────────

/** Thrown when the user cancels an interactive prompt (Ctrl+C). */
export class CancelledError extends Error {
  constructor(message = 'Cancelled.') {
    super(message)
    this.name = 'CancelledError'
  }
}

// ─── Rudder Registry ──────────────────────────────────────

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

export class CommandRegistry {
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
  description?: string
}

export interface CommandOptDef {
  name:          string
  shorthand?:    string
  hasValue:      boolean
  defaultValue?: string
  description?:  string
}

export interface ParsedSignature {
  name: string
  args: CommandArgDef[]
  opts: CommandOptDef[]
}

export function parseSignature(signature: string): ParsedSignature {
  const nameMatch = signature.match(/^([\w:.-]+)/)
  if (!nameMatch?.[1]) {
    throw new Error(`Invalid command signature: "${signature}". Must start with a valid command name (letters, digits, :, ., -).`)
  }
  const name = nameMatch[1]
  const args: CommandArgDef[] = []
  const opts: CommandOptDef[] = []

  for (const [, block] of signature.matchAll(/\{([^}]+)\}/g)) {
    // Split inline description: {user : The user ID} → token=`user`, description=`The user ID`
    const colonIdx  = (block ?? '').indexOf(':')
    const trimmed   = (colonIdx === -1 ? (block ?? '') : (block ?? '').slice(0, colonIdx)).trim()
    const description = colonIdx === -1 ? undefined : (block ?? '').slice(colonIdx + 1).trim() || undefined

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
      if (description)  optDef.description  = description
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
      if (description)  argDef.description  = description
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

// Lazy singleton for @clack/prompts — loaded once on first prompt call
let _clack: typeof import('@clack/prompts') | undefined

async function clack(): Promise<typeof import('@clack/prompts')> {
  if (!_clack) _clack = await import('@clack/prompts')
  return _clack
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
    // Normalise ragged rows so every row has the same column count as headers
    const cols = headers.length
    const normalised = rows.map(r =>
      Array.from({ length: cols }, (_, i) => r[i] ?? '')
    )
    const widths = headers.map((h, i) =>
      Math.max(h.length, ...normalised.map(r => (r[i] ?? '').length))
    )
    const sep = widths.map(w => '-'.repeat(w + 2)).join('+')
    const fmt = (cells: string[]) =>
      cells.map((c, i) => ` ${c.padEnd(widths[i] ?? 0)} `).join('|')
    console.log(sep)
    console.log(fmt(headers))
    console.log(sep)
    for (const row of normalised) console.log(fmt(row))
    console.log(sep)
  }

  // ── Interactive prompts ───────────────────────────────────

  /**
   * Ask the user a text question.
   * @throws {CancelledError} if the user presses Ctrl+C.
   */
  async ask(message: string, defaultValue?: string): Promise<string> {
    const { text, isCancel } = await clack()
    const opts: Parameters<typeof text>[0] = { message }
    if (defaultValue) { opts.defaultValue = defaultValue; opts.placeholder = defaultValue }
    const result = await text(opts)
    if (isCancel(result)) throw new CancelledError()
    return result as string
  }

  /**
   * Ask the user a yes/no question.
   * @throws {CancelledError} if the user presses Ctrl+C.
   */
  async confirm(message: string, defaultValue = false): Promise<boolean> {
    const { confirm, isCancel } = await clack()
    const result = await confirm({ message, initialValue: defaultValue })
    if (isCancel(result)) throw new CancelledError()
    return result as boolean
  }

  /**
   * Present a list of choices to the user.
   * @throws {CancelledError} if the user presses Ctrl+C.
   */
  async choice(message: string, choices: string[], defaultValue?: string): Promise<string> {
    const { select, isCancel } = await clack()
    const result = await select({
      message,
      options: choices.map(c => ({ value: c, label: c })),
      initialValue: defaultValue ?? choices[0],
    })
    if (isCancel(result)) throw new CancelledError()
    return result as string
  }

  /**
   * Ask the user for a secret (input is hidden).
   * @throws {CancelledError} if the user presses Ctrl+C.
   */
  async secret(message: string): Promise<string> {
    const { password, isCancel } = await clack()
    const result = await password({ message })
    if (isCancel(result)) throw new CancelledError()
    return result as string
  }

  // ── Lifecycle ─────────────────────────────────────────────

  abstract handle(): void | Promise<void>
}

// ─── Global rudder singleton ──────────────────────────────

const _g = globalThis as Record<string, unknown>
if (!_g['__rudderjs_rudder__']) _g['__rudderjs_rudder__'] = new CommandRegistry()

/** Global Rudder command registry — import and call rudder.command() in routes/console.ts */
export const rudder = _g['__rudderjs_rudder__'] as CommandRegistry

/** Alias for rudder — Laravel-style capitalised name */
export const Rudder = rudder

// ─── Command observers ─────────────────────────────────────
//
// Lightweight publish/subscribe used by `@rudderjs/cli` to notify any
// interested party that a command has finished running. Used today by
// `@rudderjs/telescope`'s CommandCollector to record every CLI invocation
// into the dashboard. Any package can subscribe — telescope is the
// reference consumer.

export interface CommandObservation {
  name:     string
  args:     Record<string, unknown>
  opts:     Record<string, unknown>
  duration: number
  exitCode: number
  /** Source of the command — class-based via `register()` or inline via `command()` */
  source:   'class' | 'inline'
  /** Error thrown by the command action, if any */
  error?:   Error
}

export type CommandObserver = (obs: CommandObservation) => void

export class CommandObserverRegistry {
  private observers: CommandObserver[] = []

  /** Subscribe; returns an unsubscribe function. */
  subscribe(fn: CommandObserver): () => void {
    this.observers.push(fn)
    return () => { this.observers = this.observers.filter(o => o !== fn) }
  }

  /** Called by `@rudderjs/cli` after each command runs. Errors in observers are swallowed. */
  emit(obs: CommandObservation): void {
    for (const o of this.observers) {
      try { o(obs) } catch { /* observer errors must not break the CLI */ }
    }
  }

  /** @internal — used in tests */
  reset(): void { this.observers = [] }
}

if (!_g['__rudderjs_command_observers__']) _g['__rudderjs_command_observers__'] = new CommandObserverRegistry()

/** Global command observer registry — process-wide singleton like `rudder`. */
export const commandObservers = _g['__rudderjs_command_observers__'] as CommandObserverRegistry
