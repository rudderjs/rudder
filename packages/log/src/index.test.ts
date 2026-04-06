import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  Log, LogRegistry, LogFake, LogChannel,
  ConsoleAdapter, FileAdapter, DailyAdapter, StackAdapter, NullAdapter,
  LineFormatter, JsonFormatter,
  type LogEntry, type LogLevel, type LogAdapter,
  logger, log as logProvider, extendLog,
} from './index.js'

// ─── Helpers ───────────────────────────────────────────────

class CollectorAdapter implements LogAdapter {
  entries: LogEntry[] = []
  log(entry: LogEntry): void { this.entries.push(entry) }
}

function setup(level: LogLevel = 'debug'): CollectorAdapter {
  const adapter = new CollectorAdapter()
  LogRegistry.register('test', adapter, level)
  LogRegistry.setDefault('test')
  return adapter
}

// ─── Tests ─────────────────────────────────────────────────

describe('@rudderjs/log', () => {
  beforeEach(() => LogRegistry.reset())
  afterEach(() => LogRegistry.reset())

  // ── Log Levels ──

  describe('log levels', () => {
    it('logs all levels when channel is set to debug', () => {
      const col = setup('debug')
      const levels: LogLevel[] = ['emergency', 'alert', 'critical', 'error', 'warning', 'notice', 'info', 'debug']
      for (const level of levels) Log.log(level, `${level} message`)
      assert.equal(col.entries.length, 8)
    })

    it('filters messages below minimum level', () => {
      const col = setup('error')
      Log.debug('dropped')
      Log.info('dropped')
      Log.warning('dropped')
      Log.error('kept')
      Log.critical('kept')
      assert.equal(col.entries.length, 2)
    })

    it('emergency is always logged', () => {
      const col = setup('emergency')
      Log.debug('dropped')
      Log.emergency('kept')
      assert.equal(col.entries.length, 1)
      assert.equal(col.entries[0]!.level, 'emergency')
    })
  })

  // ── Context ──

  describe('context', () => {
    it('includes inline context', () => {
      const col = setup()
      Log.info('hello', { userId: 42 })
      assert.deepEqual(col.entries[0]!.context, { userId: 42 })
    })

    it('merges per-channel context', () => {
      const col = setup()
      Log.withContext({ requestId: 'abc' })
      Log.info('hello', { extra: true })
      assert.deepEqual(col.entries[0]!.context, { requestId: 'abc', extra: true })
    })

    it('merges shared context across channels', () => {
      const col1 = new CollectorAdapter()
      const col2 = new CollectorAdapter()
      LogRegistry.register('ch1', col1, 'debug')
      LogRegistry.register('ch2', col2, 'debug')

      LogRegistry.shareContext({ appVersion: '1.0' })

      LogRegistry.channel('ch1').log('info', 'from ch1', {})
      LogRegistry.channel('ch2').log('info', 'from ch2', {})

      assert.deepEqual(col1.entries[0]!.context, { appVersion: '1.0' })
      assert.deepEqual(col2.entries[0]!.context, { appVersion: '1.0' })
    })

    it('removes context with withoutContext', () => {
      const col = setup()
      Log.withContext({ a: 1, b: 2 })
      Log.withoutContext(['a'])
      Log.info('test')
      assert.deepEqual(col.entries[0]!.context, { b: 2 })
    })

    it('flushes shared context', () => {
      const col = setup()
      Log.shareContext({ x: 1 })
      Log.flushSharedContext()
      Log.info('test')
      assert.deepEqual(col.entries[0]!.context, {})
    })

    it('inline context overrides shared/channel context', () => {
      const col = setup()
      Log.shareContext({ key: 'shared' })
      Log.withContext({ key: 'channel' })
      Log.info('test', { key: 'inline' })
      assert.equal(col.entries[0]!.context['key'], 'inline')
    })
  })

  // ── Channel Selection ──

  describe('channel selection', () => {
    it('selects a specific channel', () => {
      const col = new CollectorAdapter()
      LogRegistry.register('custom', col, 'debug')
      LogRegistry.register('other', new CollectorAdapter(), 'debug')
      LogRegistry.setDefault('other')

      Log.channel('custom').info('targeted')
      assert.equal(col.entries.length, 1)
      assert.equal(col.entries[0]!.message, 'targeted')
    })

    it('throws for unknown channel', () => {
      assert.throws(() => Log.channel('nope'), /not registered/)
    })
  })

  // ── Stack Adapter ──

  describe('StackAdapter', () => {
    it('fans out to multiple adapters', async () => {
      const col1 = new CollectorAdapter()
      const col2 = new CollectorAdapter()
      const stack = new StackAdapter([col1, col2])
      LogRegistry.register('stack', stack, 'debug')
      LogRegistry.setDefault('stack')

      await Log.info('broadcast')
      assert.equal(col1.entries.length, 1)
      assert.equal(col2.entries.length, 1)
    })

    it('ignoreExceptions swallows adapter errors', async () => {
      const failing: LogAdapter = { log() { throw new Error('fail') } }
      const col = new CollectorAdapter()
      const stack = new StackAdapter([failing, col], true)
      LogRegistry.register('stack', stack, 'debug')
      LogRegistry.setDefault('stack')

      await Log.info('should not throw')
      assert.equal(col.entries.length, 1)
    })
  })

  // ── Null Adapter ──

  describe('NullAdapter', () => {
    it('discards all messages', () => {
      LogRegistry.register('null', new NullAdapter(), 'debug')
      LogRegistry.setDefault('null')
      Log.info('gone')
      // no error, nothing stored
    })
  })

  // ── Formatters ──

  describe('LineFormatter', () => {
    it('formats with timestamp, channel, level, message', () => {
      const fmt = new LineFormatter()
      const entry: LogEntry = {
        level: 'info', message: 'hello', context: {},
        timestamp: new Date('2026-01-15T10:30:00Z'), channel: 'test',
      }
      const line = fmt.format(entry)
      assert.match(line, /\[2026-01-15T10:30:00.000Z\] test\.INFO\s+hello/)
    })

    it('includes context as JSON when present', () => {
      const fmt = new LineFormatter()
      const entry: LogEntry = {
        level: 'error', message: 'fail', context: { code: 500 },
        timestamp: new Date('2026-01-15T10:30:00Z'), channel: 'app',
      }
      const line = fmt.format(entry)
      assert.ok(line.includes('{"code":500}'))
    })
  })

  describe('JsonFormatter', () => {
    it('formats as valid JSON', () => {
      const fmt = new JsonFormatter()
      const entry: LogEntry = {
        level: 'warning', message: 'watch out', context: { x: 1 },
        timestamp: new Date('2026-01-15T10:30:00Z'), channel: 'json',
      }
      const parsed = JSON.parse(fmt.format(entry))
      assert.equal(parsed.level, 'warning')
      assert.equal(parsed.message, 'watch out')
      assert.equal(parsed.channel, 'json')
      assert.deepEqual(parsed.context, { x: 1 })
    })

    it('omits context key when empty', () => {
      const fmt = new JsonFormatter()
      const entry: LogEntry = {
        level: 'info', message: 'clean', context: {},
        timestamp: new Date('2026-01-15T10:30:00Z'), channel: 'json',
      }
      const parsed = JSON.parse(fmt.format(entry))
      assert.equal(parsed.context, undefined)
    })
  })

  // ── LogFake ──

  describe('LogFake', () => {
    it('captures log entries', () => {
      const fake = new LogFake()
      LogRegistry.register('fake', fake, 'debug')
      LogRegistry.setDefault('fake')

      Log.info('hello')
      Log.error('oops')
      assert.equal(fake.entries.length, 2)
    })

    it('assertLogged passes for matching entry', () => {
      const fake = new LogFake()
      LogRegistry.register('fake', fake, 'debug')
      LogRegistry.setDefault('fake')

      Log.info('user created')
      fake.assertLogged('info', 'user created')
    })

    it('assertLogged fails for missing entry', () => {
      const fake = new LogFake()
      LogRegistry.register('fake', fake, 'debug')
      LogRegistry.setDefault('fake')

      assert.throws(() => fake.assertLogged('error', 'nope'), /Expected/)
    })

    it('assertNotLogged passes when no match', () => {
      const fake = new LogFake()
      LogRegistry.register('fake', fake, 'debug')
      LogRegistry.setDefault('fake')

      Log.info('hello')
      fake.assertNotLogged('error')
    })

    it('assertLoggedTimes checks count', () => {
      const fake = new LogFake()
      LogRegistry.register('fake', fake, 'debug')
      LogRegistry.setDefault('fake')

      Log.info('hit')
      Log.info('hit')
      Log.info('miss')
      fake.assertLoggedTimes('info', 2, 'hit')
    })

    it('assertNothingLogged fails when entries exist', () => {
      const fake = new LogFake()
      LogRegistry.register('fake', fake, 'debug')
      LogRegistry.setDefault('fake')

      Log.debug('something')
      assert.throws(() => fake.assertNothingLogged(), /Expected no log/)
    })

    it('assertLogged with predicate function', () => {
      const fake = new LogFake()
      LogRegistry.register('fake', fake, 'debug')
      LogRegistry.setDefault('fake')

      Log.info('order processed', { orderId: 123 })
      fake.assertLogged('info', (msg, ctx) => msg.includes('order') && ctx['orderId'] === 123)
    })
  })

  // ── Listeners ──

  describe('listeners', () => {
    it('fires listener for every log entry', () => {
      setup()
      const received: LogEntry[] = []
      Log.listen((entry) => received.push(entry))

      Log.info('one')
      Log.error('two')
      assert.equal(received.length, 2)
      assert.equal(received[0]!.message, 'one')
      assert.equal(received[1]!.level, 'error')
    })
  })

  // ── logger() helper ──

  describe('logger() helper', () => {
    it('returns Log facade when called without args', () => {
      const result = logger()
      assert.equal(result, Log)
    })

    it('logs debug message when called with string', () => {
      const col = setup()
      logger('quick debug')
      assert.equal(col.entries.length, 1)
      assert.equal(col.entries[0]!.level, 'debug')
      assert.equal(col.entries[0]!.message, 'quick debug')
    })
  })

  // ── Custom Drivers ──

  describe('extendLog', () => {
    it('registers and resolves custom driver', () => {
      const col = new CollectorAdapter()
      extendLog('custom-test', () => col)

      LogRegistry.register('mychannel', col, 'debug')
      LogRegistry.setDefault('mychannel')

      Log.info('custom driver works')
      assert.equal(col.entries.length, 1)
    })
  })

  // ── On-demand Stack ──

  describe('Log.stack()', () => {
    it('creates an on-demand stack', async () => {
      const col1 = new CollectorAdapter()
      const col2 = new CollectorAdapter()
      LogRegistry.register('a', col1, 'debug')
      LogRegistry.register('b', col2, 'debug')
      LogRegistry.register('default', new CollectorAdapter(), 'debug')
      LogRegistry.setDefault('default')

      await Log.stack(['a', 'b']).info('broadcast')
      assert.equal(col1.entries.length, 1)
      assert.equal(col2.entries.length, 1)
    })
  })

  // ── Registry Management ──

  describe('LogRegistry', () => {
    it('lists registered channels', () => {
      setup()
      LogRegistry.register('extra', new CollectorAdapter(), 'debug')
      const names = LogRegistry.getChannels()
      assert.ok(names.includes('test'))
      assert.ok(names.includes('extra'))
    })

    it('forgets a channel', () => {
      setup()
      LogRegistry.forgetChannel('test')
      assert.throws(() => LogRegistry.channel('test'), /not registered/)
    })
  })

  // ── LogEntry structure ──

  describe('LogEntry', () => {
    it('includes timestamp and channel name', () => {
      const col = setup()
      Log.info('test')
      const entry = col.entries[0]!
      assert.ok(entry.timestamp instanceof Date)
      assert.equal(entry.channel, 'test')
    })
  })
})
