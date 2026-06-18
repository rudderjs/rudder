import { ServiceProvider, config, setExceptionReporter } from '@rudderjs/core'
import { appendFile, mkdir } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { dirname, resolve, relative } from 'node:path'
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

function _parseFrameLocation(frame: string): { file: string; line: number } | null {
  const m = frame.match(/\((.+?):(\d+):\d+\)$/)
  if (!m || !m[1] || !m[2]) return null
  const file = m[1]
  if (file.startsWith('node:') || file.includes('node_modules')) return null
  return { file, line: parseInt(m[2], 10) }
}

const LEVEL_BADGE_COLORS: Record<LogLevel, string> = {
  emergency: '\x1b[41m\x1b[37m',
  alert:     '\x1b[31m',
  critical:  '\x1b[31m',
  error:     '\x1b[31m',
  warning:   '\x1b[33m',
  notice:    '\x1b[36m',
  info:      '\x1b[34m',
  debug:     '\x1b[90m',
}

function _buildSnippet(file: string, targetLine: number, context = 3): string | null {
  try {
    const lines    = readFileSync(file, 'utf-8').split('\n')
    const start    = Math.max(0, targetLine - context - 1)
    const end      = Math.min(lines.length, targetLine + context)
    const numWidth = String(end).length
    const cols     = (process.stdout.columns || 120) - numWidth - 8  // room for prefix
    const dim      = (s: string) => `\x1b[2m${s}\x1b[22m`
    const red      = (s: string) => `\x1b[31m${s}\x1b[39m`
    const trunc    = (s: string) => s.length > cols ? s.slice(0, cols - 1) + '…' : s
    return lines.slice(start, end).map((content, i) => {
      const lineNum = start + i + 1
      const num     = String(lineNum).padStart(numWidth)
      if (lineNum === targetLine) {
        return `  ${red('▶')} ${red(num)} ${dim('│')} ${trunc(content)}`
      }
      return `    ${dim(num)} ${dim('│')} ${dim(trunc(content))}`
    }).join('\n')
  } catch {
    return null
  }
}

function _shortenPath(file: string, cwd: string): string {
  const home   = process.env['HOME'] ?? ''
  const relCwd = relative(cwd, file)
  if (!relCwd.startsWith('..')) return relCwd
  // Try parent dir (monorepo root) — turns ../packages/x into packages/x
  const relRoot = relative(dirname(cwd), file)
  if (!relRoot.startsWith('..')) return relRoot
  return home && file.startsWith(home) ? '~' + file.slice(home.length) : file
}

interface _FrameParts { name: string; file: string }

function _parseFrame(frame: string, cwd: string): _FrameParts {
  // `at Name (/abs/path:line:col)` or `at Name (rel/path:line:col)`
  const named = frame.match(/^at (.+?) \((.+):(\d+):\d+\)$/)
  if (named && named[1] && named[2] && named[3]) {
    const file = named[2].startsWith('/') ? _shortenPath(named[2], cwd) : named[2]
    return { name: named[1], file: `${file}:${named[3]}` }
  }
  // `at /abs/path:line:col` — anonymous
  const anon = frame.match(/^at (\/\S+):(\d+):\d+$/)
  if (anon && anon[1] && anon[2]) {
    return { name: '<anonymous>', file: `${_shortenPath(anon[1], cwd)}:${anon[2]}` }
  }
  return { name: frame.replace(/^at /, ''), file: '' }
}

function _formatFrameRow(name: string, file: string, cols: number): string {
  const dim      = (s: string) => `\x1b[2m${s}\x1b[22m`
  const indent   = '  '
  const minDots  = 3
  const gap      = cols - indent.length - name.length - 2 - file.length
  const dotCount = Math.max(minDots, gap)
  const dots     = '.'.repeat(dotCount)
  // If name+file still exceed cols, truncate file from the left
  if (indent.length + name.length + 2 + dotCount + file.length > cols) {
    const maxFile = Math.max(8, cols - indent.length - name.length - 2 - dotCount)
    const short   = file.length > maxFile ? '…' + file.slice(-(maxFile - 1)) : file
    return `${indent}${name} ${dim(dots)} ${dim(short)}`
  }
  return `${indent}${name} ${dim(dots)} ${dim(file)}`
}

/** Pretty formatter for console — `HH:MM:SS [Rudder][channel] LEVEL - message` with source snippet and app frames. */
export class ConsolePrettyFormatter implements LogFormatter {
  format(entry: LogEntry): string {
    const d    = entry.timestamp
    const hh   = String(d.getHours()).padStart(2, '0')
    const mm   = String(d.getMinutes()).padStart(2, '0')
    const ss   = String(d.getSeconds()).padStart(2, '0')
    const dim  = (s: string) => `\x1b[2m${s}\x1b[22m`
    const tag  = `\x1b[1m\x1b[38;5;208m[Rudder]\x1b[39m\x1b[22m`
    const chan  = `\x1b[1m\x1b[36m[${entry.channel}]\x1b[39m\x1b[22m`
    const lvlColor  = LEVEL_BADGE_COLORS[entry.level] ?? ''
    const lvlBadge  = `${lvlColor}${entry.level.toUpperCase()}\x1b[0m`

    const ctx   = { ...entry.context }
    const stack = typeof ctx['stack'] === 'string' ? ctx['stack'] : null
    delete ctx['stack']
    const extra = Object.keys(ctx).length ? ' ' + JSON.stringify(ctx) : ''

    // Truncate message to fit terminal width
    const cols      = process.stdout.columns || 120
    const prefixLen = `${hh}:${mm}:${ss} [Rudder][${entry.channel}] ${entry.level.toUpperCase()} - `.length
    const maxMsg    = Math.max(20, cols - prefixLen)
    const message   = entry.message.length > maxMsg ? entry.message.slice(0, maxMsg - 1) + '…' : entry.message

    let out = `${dim(`${hh}:${mm}:${ss}`)} ${tag}${chan} ${lvlBadge} ${message}${extra}`

    if (stack) {
      const cwd         = process.cwd()
      const allFrames   = stack.split('\n').slice(1).map(l => l.trim()).filter(Boolean)
      const appFrames   = allFrames.filter(l => !l.includes('node_modules') && !l.includes('node:'))
      const vendorCount = allFrames.length - appFrames.length

      const firstFrame = appFrames.find(f => _parseFrameLocation(f) !== null)
      if (firstFrame) {
        const loc     = _parseFrameLocation(firstFrame)!
        const snippet = _buildSnippet(loc.file, loc.line)
        if (snippet) {
          const rel = relative(cwd, loc.file)
          out += `\n\n  ${dim(rel + ':' + loc.line)}\n\n${snippet}\n`
        }
      }

      if (appFrames.length) {
        const frameCols = process.stdout.columns || 120
        out += '\n' + appFrames.map(l => {
          const { name, file } = _parseFrame(l, cwd)
          return _formatFrameRow(name, file, frameCols)
        }).join('\n')
      }
      if (vendorCount > 0) out += `\n  ${dim(`(+ ${vendorCount} vendor frames)`)}`
    }

    return out
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
    const output = this.formatter.format(entry)

    // ConsolePrettyFormatter embeds all ANSI itself — write as-is.
    // For other formatters, wrap the single output line in the level color.
    let out: string
    if (this.formatter instanceof ConsolePrettyFormatter) {
      out = output.replace(/\n+$/, '') + EOL + EOL
    } else {
      const color = LEVEL_COLORS[entry.level]
      out = `${color}${output}${RESET}${EOL}`
    }

    if (LEVEL_SEVERITY[entry.level] <= LEVEL_SEVERITY['error']) {
      process.stderr.write(out)
    } else {
      process.stdout.write(out)
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
      this.cleanup().catch((err: unknown) => {
        console.error('[Rudder Log] DailyAdapter cleanup error:', err)
      })
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

/**
 * Shared singleton store routed through `globalThis` so the registry survives
 * the case where `@rudderjs/log` is loaded twice — typical in a Vite-bundled
 * server where the framework bundles `@rudderjs/log` inline but
 * `LogProvider.boot()` runs from a `node_modules` copy resolved via the
 * provider auto-discovery manifest. Without a shared store, channels
 * registered from the externalized copy would never be visible to `Log.*`
 * calls reading the bundled copy — every log call would throw "Channel
 * 'console' is not registered". The shared-context surface (`shareContext`,
 * `flushSharedContext`) and the event-listener subscription used by
 * Telescope's log collector would silently drop writes the same way.
 *
 * Defensive migration per the #499 static-state singleton audit. Same pattern
 * as PR #498 (`@rudderjs/orm` `ModelRegistry`), #500–#505 (pennant, cache,
 * queue, mail, storage, hash).
 */
interface LogRegistryStore {
  channels: Map<string, Channel>
  defaultName: string
  shared: Record<string, unknown>
  eventListeners: Array<(entry: LogEntry) => void>
}

const _g = globalThis as Record<string, unknown>
if (!_g['__rudderjs_log_registry__']) {
  _g['__rudderjs_log_registry__'] = {
    channels: new Map<string, Channel>(),
    defaultName: 'console',
    shared: {},
    eventListeners: [],
  } satisfies LogRegistryStore
}
const _store = _g['__rudderjs_log_registry__'] as LogRegistryStore

export class LogRegistry {
  static register(name: string, adapter: LogAdapter, level: LogLevel = 'debug'): void {
    _store.channels.set(name, new Channel(name, adapter, level))
  }

  static channel(name: string): Channel {
    const ch = _store.channels.get(name)
    if (!ch) throw new Error(`[Rudder Log] Channel "${name}" is not registered.`)
    return ch
  }

  static default(): Channel {
    return this.channel(_store.defaultName)
  }

  static setDefault(name: string): void {
    _store.defaultName = name
  }

  static getDefault(): string {
    return _store.defaultName
  }

  /** Share context across ALL channels (current and future). */
  static shareContext(ctx: Record<string, unknown>): void {
    Object.assign(_store.shared, ctx)
  }

  static sharedContext(): Record<string, unknown> {
    return { ..._store.shared }
  }

  static flushSharedContext(): void {
    _store.shared = {}
  }

  /** Listen to all log entries. */
  static listen(fn: (entry: LogEntry) => void): void {
    _store.eventListeners.push(fn)
  }

  static listeners(): ReadonlyArray<(entry: LogEntry) => void> {
    return _store.eventListeners
  }

  /** Forget a channel (free memory, force re-creation). */
  static forgetChannel(name: string): void {
    _store.channels.delete(name)
  }

  /** Get all registered channel names. */
  static getChannels(): string[] {
    return [..._store.channels.keys()]
  }

  /** Test-cleanup hook (public — other packages reset across the boundary). */
  static reset(): void {
    _store.channels.clear()
    _store.defaultName = 'console'
    _store.shared = {}
    _store.eventListeners = []
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
//
// Routed through `globalThis` so the public `extendLog(name, factory)` API
// survives bundle splits — user app calls `extendLog('sentry', ...)` in
// `bootstrap/app.ts` (entry.mjs), `LogProvider.boot()` resolves channels via a
// node_modules-loaded copy of `@rudderjs/log` → reading from a fresh Map →
// "[Rudder Log] Unknown log driver" on every channel using the custom
// driver. Same pattern as the static-state-singleton audit.

type DriverFactory = (config: LogChannelConfig) => LogAdapter

const CUSTOM_DRIVERS_KEY = '__rudderjs_log_custom_drivers__'
const _customDriversGlobal = globalThis as Record<string, unknown>
const customDrivers: Map<string, DriverFactory> =
  (_customDriversGlobal[CUSTOM_DRIVERS_KEY] as Map<string, DriverFactory> | undefined)
  ?? (() => { const m = new Map<string, DriverFactory>(); _customDriversGlobal[CUSTOM_DRIVERS_KEY] = m; return m })()

function resolveFormatter(config: LogChannelConfig, driver?: string): LogFormatter {
  if (config.formatter === 'json') return new JsonFormatter()
  if (driver === 'console') return new ConsolePrettyFormatter()
  return new LineFormatter()
}

function resolveAdapter(config: LogChannelConfig, allChannels: Record<string, LogChannelConfig>): LogAdapter {
  const fmt = resolveFormatter(config, config.driver)

  switch (config.driver) {
    case 'console':
      return new ConsoleAdapter(fmt)

    case 'single':
      if (!config.path) throw new Error('[Rudder Log] "single" driver requires a "path" option.')
      return new FileAdapter(config.path, fmt)

    case 'daily':
      if (!config.path) throw new Error('[Rudder Log] "daily" driver requires a "path" option.')
      return new DailyAdapter(config.path, fmt, config.days ?? 14)

    case 'stack': {
      const names = config.channels ?? []
      const adapters: LogAdapter[] = []
      for (const name of names) {
        const chConfig = allChannels[name]
        if (!chConfig) throw new Error(`[Rudder Log] Stack references unknown channel "${name}".`)
        adapters.push(resolveAdapter(chConfig, allChannels))
      }
      return new StackAdapter(adapters, config.ignoreExceptions ?? false)
    }

    case 'null':
      return new NullAdapter()

    default: {
      const factory = customDrivers.get(config.driver)
      if (factory) return factory(config)
      throw new Error(`[Rudder Log] Unknown driver "${config.driver}". Available: console, single, daily, stack, null`)
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
export class LogProvider extends ServiceProvider {
  register(): void {}

  async boot(): Promise<void> {
    const cfg = config<LogConfig>('log')

    // Register all channels
    for (const [name, chConfig] of Object.entries(cfg.channels)) {
      // Skip stack channels — they'll be resolved on demand
      if (chConfig.driver === 'stack') continue
      const adapter = resolveAdapter(chConfig, cfg.channels)
      LogRegistry.register(name, adapter, chConfig.level ?? 'debug')
    }

    // Register stack channels (after all others are available)
    for (const [name, chConfig] of Object.entries(cfg.channels)) {
      if (chConfig.driver !== 'stack') continue
      const adapter = resolveAdapter(chConfig, cfg.channels)
      LogRegistry.register(name, adapter, chConfig.level ?? 'debug')
    }

    LogRegistry.setDefault(cfg.default)
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
