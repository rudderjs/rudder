import { ServiceProvider, type Application, setExceptionReporter } from '@rudderjs/core'
import { appendFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { EOL } from 'node:os'

// ─── Log Levels (RFC 5424) ─────────────────────────────────

export type LogLevel =
  | 'emergency'
  | 'alert'
  | 'critical'
  | 'error'
  | 'warning'
  | 'notice'
  | 'info'
  | 'debug'

const LEVEL_SEVERITY: Record<LogLevel, number> = {
  emergency: 0,
  alert:     1,
  critical:  2,
  error:     3,
  warning:   4,
  notice:    5,
  info:      6,
  debug:     7,
}

function meetsLevel(messageLevel: LogLevel, minLevel: LogLevel): boolean {
  return LEVEL_SEVERITY[messageLevel] <= LEVEL_SEVERITY[minLevel]
}

// ─── Log Entry ─────────────────────────────────────────────

export interface LogEntry {
  level:     LogLevel
  message:   string
  context:   Record<string, unknown>
  timestamp: Date
  channel:   string
}

// ─── Formatter Contract ────────────────────────────────────

export interface LogFormatter {
  format(entry: LogEntry): string
}

// ─── Built-in Formatters ───────────────────────────────────

export class LineFormatter implements LogFormatter {
  format(entry: LogEntry): string {
    const ts  = entry.timestamp.toISOString()
    const lvl = entry.level.toUpperCase().padEnd(9)
    const ctx = Object.keys(entry.context).length
      ? ' ' + JSON.stringify(entry.context)
      : ''
    return `[${ts}] ${entry.channel}.${lvl} ${entry.message}${ctx}`
  }
}

export class JsonFormatter implements LogFormatter {
  format(entry: LogEntry): string {
    return JSON.stringify({
      timestamp: entry.timestamp.toISOString(),
      channel:   entry.channel,
      level:     entry.level,
      message:   entry.message,
      ...(Object.keys(entry.context).length ? { context: entry.context } : {}),
    })
  }
}

// ─── Adapter Contract ──────────────────────────────────────

export interface LogAdapter {
  log(entry: LogEntry): void | Promise<void>
}

// ─── Console Adapter ───────────────────────────────────────

const LEVEL_COLORS: Record<LogLevel, string> = {
  emergency: '\x1b[41m\x1b[37m',  // white on red bg
  alert:     '\x1b[31m',           // red
  critical:  '\x1b[31m',           // red
  error:     '\x1b[31m',           // red
  warning:   '\x1b[33m',           // yellow
  notice:    '\x1b[36m',           // cyan
  info:      '\x1b[32m',           // green
  debug:     '\x1b[90m',           // gray
}

const RESET = '\x1b[0m'

export class ConsoleAdapter implements LogAdapter {
  constructor(
    private readonly formatter: LogFormatter = new LineFormatter(),
  ) {}

  log(entry: LogEntry): void {
    const line  = this.formatter.format(entry)
    const color = LEVEL_COLORS[entry.level]

    if (LEVEL_SEVERITY[entry.level] <= LEVEL_SEVERITY['error']) {
      process.stderr.write(`${color}${line}${RESET}${EOL}`)
    } else {
      process.stdout.write(`${color}${line}${RESET}${EOL}`)
    }
  }
}

// ─── File Adapter (single file) ────────────────────────────

export class FileAdapter implements LogAdapter {
  private ensured = false

  constructor(
    private readonly path: string,
    private readonly formatter: LogFormatter = new LineFormatter(),
  ) {}

  async log(entry: LogEntry): Promise<void> {
    if (!this.ensured) {
      await mkdir(dirname(this.path), { recursive: true })
      this.ensured = true
    }
    const line = this.formatter.format(entry)
    await appendFile(this.path, line + EOL, 'utf-8')
  }
}

// ─── Daily Adapter (rotating file) ─────────────────────────

export class DailyAdapter implements LogAdapter {
  private lastDate = ''
  private currentAdapter: FileAdapter | null = null

  constructor(
    private readonly pathPattern: string,  // e.g. storage/logs/rudderjs.log
    private readonly formatter: LogFormatter = new LineFormatter(),
    private readonly days: number = 14,
  ) {}

  private dateStr(): string {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  private buildPath(date: string): string {
    const ext = this.pathPattern.lastIndexOf('.')
    if (ext === -1) return `${this.pathPattern}-${date}`
    return `${this.pathPattern.slice(0, ext)}-${date}${this.pathPattern.slice(ext)}`
  }

  async log(entry: LogEntry): Promise<void> {
    const date = this.dateStr()
    if (date !== this.lastDate) {
      this.lastDate = date
      this.currentAdapter = new FileAdapter(this.buildPath(date), this.formatter)
      this.cleanup().catch(() => {})  // fire-and-forget
    }
    await this.currentAdapter!.log(entry)
  }

  private async cleanup(): Promise<void> {
    if (this.days <= 0) return
    const { readdir, unlink } = await import('node:fs/promises')
    const dir   = dirname(this.pathPattern)
    const base  = this.pathPattern.split('/').pop() ?? ''
    const ext   = base.lastIndexOf('.')
    const stem  = ext === -1 ? base : base.slice(0, ext)

    try {
      const files  = await readdir(dir)
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - this.days)
      const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`

      for (const f of files) {
        const match = f.match(new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d{4}-\\d{2}-\\d{2})`))
        if (match && match[1]! < cutoffStr) {
          await unlink(resolve(dir, f))
        }
      }
    } catch {
      // dir may not exist yet
    }
  }
}

// ─── Stack Adapter (fan-out) ───────────────────────────────

export class StackAdapter implements LogAdapter {
  constructor(
    private readonly adapters: LogAdapter[],
    private readonly ignoreExceptions = false,
  ) {}

  async log(entry: LogEntry): Promise<void> {
    for (const adapter of this.adapters) {
      if (this.ignoreExceptions) {
        try { await adapter.log(entry) } catch { /* swallow */ }
      } else {
        await adapter.log(entry)
      }
    }
  }
}

// ─── Null Adapter ──────────────────────────────────────────

export class NullAdapter implements LogAdapter {
  log(): void {}
}

// ─── Channel Wrapper (level filtering + context) ───────────

class Channel {
  private localContext: Record<string, unknown> = {}

  constructor(
    readonly name: string,
    private readonly adapter: LogAdapter,
    private readonly minLevel: LogLevel,
  ) {}

  withContext(ctx: Record<string, unknown>): void {
    Object.assign(this.localContext, ctx)
  }

  withoutContext(keys?: string[]): void {
    if (!keys) { this.localContext = {}; return }
    for (const k of keys) delete this.localContext[k]
  }

  log(level: LogLevel, message: string, context: Record<string, unknown>): void | Promise<void> {
    if (!meetsLevel(level, this.minLevel)) return

    const entry: LogEntry = {
      level,
      message,
      context: { ...LogRegistry.sharedContext(), ...this.localContext, ...context },
      timestamp: new Date(),
      channel: this.name,
    }

    // Dispatch event
    for (const listener of LogRegistry.listeners()) {
      listener(entry)
    }

    return this.adapter.log(entry)
  }
}

// ─── Log Registry ──────────────────────────────────────────

export class LogRegistry {
  private static channels = new Map<string, Channel>()
  private static defaultName = 'console'
  private static shared: Record<string, unknown> = {}
  private static eventListeners: Array<(entry: LogEntry) => void> = []

  static register(name: string, adapter: LogAdapter, level: LogLevel = 'debug'): void {
    this.channels.set(name, new Channel(name, adapter, level))
  }

  static channel(name: string): Channel {
    const ch = this.channels.get(name)
    if (!ch) throw new Error(`[RudderJS Log] Channel "${name}" is not registered.`)
    return ch
  }

  static default(): Channel {
    return this.channel(this.defaultName)
  }

  static setDefault(name: string): void {
    this.defaultName = name
  }

  static getDefault(): string {
    return this.defaultName
  }

  /** Share context across ALL channels (current and future). */
  static shareContext(ctx: Record<string, unknown>): void {
    Object.assign(this.shared, ctx)
  }

  static sharedContext(): Record<string, unknown> {
    return { ...this.shared }
  }

  static flushSharedContext(): void {
    this.shared = {}
  }

  /** Listen to all log entries. */
  static listen(fn: (entry: LogEntry) => void): void {
    this.eventListeners.push(fn)
  }

  static listeners(): ReadonlyArray<(entry: LogEntry) => void> {
    return this.eventListeners
  }

  /** Forget a channel (free memory, force re-creation). */
  static forgetChannel(name: string): void {
    this.channels.delete(name)
  }

  /** Get all registered channel names. */
  static getChannels(): string[] {
    return [...this.channels.keys()]
  }

  /** @internal */
  static reset(): void {
    this.channels.clear()
    this.defaultName = 'console'
    this.shared = {}
    this.eventListeners = []
  }
}

// ─── Log Facade ────────────────────────────────────────────

export class Log {
  // ── Channel selection ──

  /** Get a specific channel by name. */
  static channel(name: string): LogChannel {
    return new LogChannel(LogRegistry.channel(name))
  }

  /** Create an on-demand stack of channels. */
  static stack(channels: string[], ignoreExceptions = false): LogChannel {
    const resolvedChannels = channels.map((n) => LogRegistry.channel(n))
    const stackAdapter: LogAdapter = {
      async log(entry: LogEntry): Promise<void> {
        for (const ch of resolvedChannels) {
          if (ignoreExceptions) {
            try { await ch.log(entry.level, entry.message, entry.context) } catch { /* swallow */ }
          } else {
            await ch.log(entry.level, entry.message, entry.context)
          }
        }
      },
    }
    const stackChannel = new Channel('stack', stackAdapter, 'debug')
    return new LogChannel(stackChannel)
  }

  // ── Context ──

  /** Add context to the default channel. */
  static withContext(ctx: Record<string, unknown>): void {
    LogRegistry.default().withContext(ctx)
  }

  /** Remove context keys from the default channel. */
  static withoutContext(keys?: string[]): void {
    LogRegistry.default().withoutContext(keys)
  }

  /** Share context across all channels. */
  static shareContext(ctx: Record<string, unknown>): void {
    LogRegistry.shareContext(ctx)
  }

  /** Get current shared context. */
  static sharedContext(): Record<string, unknown> {
    return LogRegistry.sharedContext()
  }

  /** Flush all shared context. */
  static flushSharedContext(): void {
    LogRegistry.flushSharedContext()
  }

  // ── Listeners ──

  /** Listen for all log entries. */
  static listen(fn: (entry: LogEntry) => void): void {
    LogRegistry.listen(fn)
  }

  // ── Level Methods ──

  static emergency(message: string, context: Record<string, unknown> = {}): void | Promise<void> {
    return LogRegistry.default().log('emergency', message, context)
  }

  static alert(message: string, context: Record<string, unknown> = {}): void | Promise<void> {
    return LogRegistry.default().log('alert', message, context)
  }

  static critical(message: string, context: Record<string, unknown> = {}): void | Promise<void> {
    return LogRegistry.default().log('critical', message, context)
  }

  static error(message: string, context: Record<string, unknown> = {}): void | Promise<void> {
    return LogRegistry.default().log('error', message, context)
  }

  static warning(message: string, context: Record<string, unknown> = {}): void | Promise<void> {
    return LogRegistry.default().log('warning', message, context)
  }

  static notice(message: string, context: Record<string, unknown> = {}): void | Promise<void> {
    return LogRegistry.default().log('notice', message, context)
  }

  static info(message: string, context: Record<string, unknown> = {}): void | Promise<void> {
    return LogRegistry.default().log('info', message, context)
  }

  static debug(message: string, context: Record<string, unknown> = {}): void | Promise<void> {
    return LogRegistry.default().log('debug', message, context)
  }

  static log(level: LogLevel, message: string, context: Record<string, unknown> = {}): void | Promise<void> {
    return LogRegistry.default().log(level, message, context)
  }
}

// ─── Log Channel (fluent wrapper for channel selection) ────

export class LogChannel {
  constructor(private readonly ch: Channel) {}

  withContext(ctx: Record<string, unknown>): this {
    this.ch.withContext(ctx)
    return this
  }

  withoutContext(keys?: string[]): this {
    this.ch.withoutContext(keys)
    return this
  }

  emergency(message: string, context: Record<string, unknown> = {}): void | Promise<void> {
    return this.ch.log('emergency', message, context)
  }

  alert(message: string, context: Record<string, unknown> = {}): void | Promise<void> {
    return this.ch.log('alert', message, context)
  }

  critical(message: string, context: Record<string, unknown> = {}): void | Promise<void> {
    return this.ch.log('critical', message, context)
  }

  error(message: string, context: Record<string, unknown> = {}): void | Promise<void> {
    return this.ch.log('error', message, context)
  }

  warning(message: string, context: Record<string, unknown> = {}): void | Promise<void> {
    return this.ch.log('warning', message, context)
  }

  notice(message: string, context: Record<string, unknown> = {}): void | Promise<void> {
    return this.ch.log('notice', message, context)
  }

  info(message: string, context: Record<string, unknown> = {}): void | Promise<void> {
    return this.ch.log('info', message, context)
  }

  debug(message: string, context: Record<string, unknown> = {}): void | Promise<void> {
    return this.ch.log('debug', message, context)
  }

  log(level: LogLevel, message: string, context: Record<string, unknown> = {}): void | Promise<void> {
    return this.ch.log(level, message, context)
  }
}

// ─── Log Fake (for testing) ────────────────────────────────

export interface FakeLogEntry {
  level:   LogLevel
  message: string
  context: Record<string, unknown>
}

export class LogFake implements LogAdapter {
  readonly entries: FakeLogEntry[] = []

  log(entry: LogEntry): void {
    this.entries.push({ level: entry.level, message: entry.message, context: entry.context })
  }

  assertLogged(level: LogLevel, match?: string | ((msg: string, ctx: Record<string, unknown>) => boolean)): void {
    const found = this.entries.some((e) => {
      if (e.level !== level) return false
      if (!match) return true
      if (typeof match === 'string') return e.message.includes(match)
      return match(e.message, e.context)
    })
    if (!found) throw new Error(`[LogFake] Expected a "${level}" log entry${match ? ` matching "${match}"` : ''}, but none was found.`)
  }

  assertNotLogged(level: LogLevel, match?: string): void {
    const found = this.entries.some((e) => {
      if (e.level !== level) return false
      if (!match) return true
      return e.message.includes(match)
    })
    if (found) throw new Error(`[LogFake] Unexpected "${level}" log entry${match ? ` matching "${match}"` : ''} was found.`)
  }

  assertLoggedTimes(level: LogLevel, count: number, match?: string): void {
    const actual = this.entries.filter((e) => {
      if (e.level !== level) return false
      if (!match) return true
      return e.message.includes(match)
    }).length
    if (actual !== count) throw new Error(`[LogFake] Expected ${count} "${level}" entries${match ? ` matching "${match}"` : ''}, got ${actual}.`)
  }

  assertNothingLogged(): void {
    if (this.entries.length > 0) throw new Error(`[LogFake] Expected no log entries, but ${this.entries.length} were found.`)
  }

  clear(): void {
    this.entries.length = 0
  }
}

// ─── Config ────────────────────────────────────────────────

export interface LogChannelConfig {
  driver:    string
  level?:    LogLevel
  /** File path — used by `single` and `daily` drivers */
  path?:     string
  /** Retention days — used by `daily` driver (default 14) */
  days?:     number
  /** Sub-channel names — used by `stack` driver */
  channels?: string[]
  /** Swallow sub-channel errors — used by `stack` driver */
  ignoreExceptions?: boolean
  /** Formatter class: 'line' (default) or 'json' */
  formatter?: 'line' | 'json'
  /** Extra config for custom drivers */
  [key: string]: unknown
}

export interface LogConfig {
  /** Default channel name */
  default: string
  /** Named channels */
  channels: Record<string, LogChannelConfig>
}

// ─── Helpers ───────────────────────────────────────────────

/** Shortcut: `logger()` returns the Log facade; `logger('msg')` logs at debug level. */
export function logger(message?: string, context?: Record<string, unknown>): typeof Log | void {
  if (message !== undefined) return Log.debug(message, context) as void
  return Log
}

// ─── Driver Registry (for custom drivers) ──────────────────

type DriverFactory = (config: LogChannelConfig) => LogAdapter

const customDrivers = new Map<string, DriverFactory>()

function resolveFormatter(config: LogChannelConfig): LogFormatter {
  if (config.formatter === 'json') return new JsonFormatter()
  return new LineFormatter()
}

function resolveAdapter(config: LogChannelConfig, allChannels: Record<string, LogChannelConfig>): LogAdapter {
  const fmt = resolveFormatter(config)

  switch (config.driver) {
    case 'console':
      return new ConsoleAdapter(fmt)

    case 'single':
      if (!config.path) throw new Error('[RudderJS Log] "single" driver requires a "path" option.')
      return new FileAdapter(config.path, fmt)

    case 'daily':
      if (!config.path) throw new Error('[RudderJS Log] "daily" driver requires a "path" option.')
      return new DailyAdapter(config.path, fmt, config.days ?? 14)

    case 'stack': {
      const names = config.channels ?? []
      const adapters: LogAdapter[] = []
      for (const name of names) {
        const chConfig = allChannels[name]
        if (!chConfig) throw new Error(`[RudderJS Log] Stack references unknown channel "${name}".`)
        adapters.push(resolveAdapter(chConfig, allChannels))
      }
      return new StackAdapter(adapters, config.ignoreExceptions ?? false)
    }

    case 'null':
      return new NullAdapter()

    default: {
      const factory = customDrivers.get(config.driver)
      if (factory) return factory(config)
      throw new Error(`[RudderJS Log] Unknown driver "${config.driver}". Available: console, single, daily, stack, null`)
    }
  }
}

// ─── Service Provider Factory ──────────────────────────────

/**
 * Returns a LogServiceProvider configured for the given log config.
 *
 * Built-in drivers:
 *   console  — stdout/stderr with ANSI colors
 *   single   — single log file
 *   daily    — daily-rotated log files (configurable retention)
 *   stack    — fan-out to multiple channels
 *   null     — discard all messages
 *
 * Usage in bootstrap/providers.ts:
 *   import { log } from '@rudderjs/log'
 *   export default [..., log(configs.log), ...]
 */
export function log(config: LogConfig): new (app: Application) => ServiceProvider {
  class LogServiceProvider extends ServiceProvider {
    register(): void {}

    async boot(): Promise<void> {
      // Register all channels
      for (const [name, chConfig] of Object.entries(config.channels)) {
        // Skip stack channels — they'll be resolved on demand
        if (chConfig.driver === 'stack') continue
        const adapter = resolveAdapter(chConfig, config.channels)
        LogRegistry.register(name, adapter, chConfig.level ?? 'debug')
      }

      // Register stack channels (after all others are available)
      for (const [name, chConfig] of Object.entries(config.channels)) {
        if (chConfig.driver !== 'stack') continue
        const adapter = resolveAdapter(chConfig, config.channels)
        LogRegistry.register(name, adapter, chConfig.level ?? 'debug')
      }

      LogRegistry.setDefault(config.default)
      this.app.instance('log', Log)

      // Wire unhandled exceptions through the log channel
      setExceptionReporter((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        const context: Record<string, unknown> = {}
        if (err instanceof Error && err.stack) context['stack'] = err.stack
        void Log.error(message, context)
      })
    }
  }

  return LogServiceProvider
}

/**
 * Register a custom log driver.
 *
 * @example
 * ```ts
 * import { extendLog } from '@rudderjs/log'
 * extendLog('sentry', (config) => new SentryAdapter(config.dsn))
 * ```
 */
export function extendLog(driver: string, factory: DriverFactory): void {
  customDrivers.set(driver, factory)
}
