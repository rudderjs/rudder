import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Rudder, Command, CommandBuilder, CommandRegistry, parseSignature, CancelledError } from './index.js'

// ─── CommandRegistry ──────────────────────────────────────

describe('CommandRegistry', () => {
  let registry: CommandRegistry

  beforeEach(() => {
    registry = new CommandRegistry()
  })

  it('command() registers and returns a CommandBuilder', () => {
    const builder = registry.command('greet {name}', () => undefined)
    assert.ok(builder instanceof CommandBuilder)
    assert.strictEqual(builder.name, 'greet {name}')
    assert.strictEqual(registry.getCommands().length, 1)
  })

  it('command() supports fluent description chaining', () => {
    const builder = registry.command('ping', () => undefined)
      .description('Ping the server')
    assert.strictEqual(builder.getDescription(), 'Ping the server')
  })

  it('command() supports fluent purpose() chaining', () => {
    const builder = registry.command('ping', () => undefined)
      .purpose('Ping the server')
    assert.strictEqual(builder.getDescription(), 'Ping the server')
  })

  it('register() stores class-based commands', () => {
    class A extends Command {
      readonly signature = 'a'
      readonly description = 'a'
      handle(): void {}
    }
    class B extends Command {
      readonly signature = 'b'
      readonly description = 'b'
      handle(): void {}
    }
    registry.register(A, B)
    assert.deepStrictEqual(registry.getClasses(), [A, B])
  })

  it('register() appends to existing classes', () => {
    class A extends Command {
      readonly signature = 'a'
      readonly description = 'a'
      handle(): void {}
    }
    class B extends Command {
      readonly signature = 'b'
      readonly description = 'b'
      handle(): void {}
    }
    registry.register(A)
    registry.register(B)
    assert.strictEqual(registry.getClasses().length, 2)
  })

  it('reset() clears both commands and classes', () => {
    class A extends Command {
      readonly signature = 'a'
      readonly description = 'a'
      handle(): void {}
    }
    registry.command('x', () => undefined)
    registry.register(A)
    registry.reset()
    assert.strictEqual(registry.getCommands().length, 0)
    assert.strictEqual(registry.getClasses().length, 0)
  })

  it('getCommands() returns all registered functional commands', () => {
    registry.command('a', () => undefined)
    registry.command('b', () => undefined)
    assert.strictEqual(registry.getCommands().length, 2)
    assert.strictEqual(registry.getCommands()[0]!.name, 'a')
    assert.strictEqual(registry.getCommands()[1]!.name, 'b')
  })
})

// ─── Global rudder singleton ──────────────────────────────

describe('global rudder singleton', () => {
  beforeEach(() => Rudder.reset())

  it('Rudder is the same instance across multiple imports', async () => {
    const { Rudder: Rudder2 } = await import('./index.js')
    assert.strictEqual(Rudder, Rudder2)
  })

  it('Rudder.command() registers a command', () => {
    const name = `test:${Date.now()}`
    Rudder.command(name, () => undefined)
    const found = Rudder.getCommands().find(c => c.name === name)
    assert.ok(found)
  })

  it('Rudder.register() registers class-based commands', () => {
    class HelloCommand extends Command {
      readonly signature = 'hello'
      readonly description = 'hello cmd'
      handle(): void {}
    }
    Rudder.register(HelloCommand)
    assert.deepStrictEqual(Rudder.getClasses(), [HelloCommand])
  })

  it('Rudder.reset() clears registered commands and classes', () => {
    class A extends Command {
      readonly signature = 'a'
      readonly description = 'a'
      handle(): void {}
    }
    Rudder.command('x', () => undefined)
    Rudder.register(A)
    Rudder.reset()
    assert.strictEqual(Rudder.getCommands().length, 0)
    assert.strictEqual(Rudder.getClasses().length, 0)
  })
})

// ─── parseSignature ────────────────────────────────────────

describe('parseSignature', () => {
  describe('command name', () => {
    it('parses a simple name', () => {
      assert.strictEqual(parseSignature('greet').name, 'greet')
    })

    it('parses a colon-namespaced name', () => {
      assert.strictEqual(parseSignature('users:create').name, 'users:create')
    })

    it('parses a name with dots and hyphens', () => {
      assert.strictEqual(parseSignature('db.migrate-fresh').name, 'db.migrate-fresh')
    })

    it('throws on an empty or invalid signature', () => {
      assert.throws(() => parseSignature(''), /Invalid command signature/)
      assert.throws(() => parseSignature('{arg}'), /Invalid command signature/)
    })
  })

  describe('arguments', () => {
    it('parses a required argument', () => {
      const { args } = parseSignature('cmd {name}')
      assert.deepStrictEqual(args, [{ name: 'name', required: true, variadic: false }])
    })

    it('parses an optional argument (trailing ?)', () => {
      const { args } = parseSignature('cmd {name?}')
      assert.deepStrictEqual(args, [{ name: 'name', required: false, variadic: false }])
    })

    it('parses a variadic argument (trailing *)', () => {
      const { args } = parseSignature('cmd {files*}')
      assert.deepStrictEqual(args, [{ name: 'files', required: false, variadic: true }])
    })

    it('parses an argument with a default value', () => {
      const { args } = parseSignature('cmd {env=local}')
      assert.deepStrictEqual(args, [
        { name: 'env', required: false, variadic: false, defaultValue: 'local' },
      ])
    })

    it('parses multiple arguments', () => {
      const { args } = parseSignature('cmd {name} {email?} {role=user}')
      assert.strictEqual(args.length, 3)
      assert.strictEqual(args[0]!.required, true)
      assert.strictEqual(args[1]!.required, false)
      assert.strictEqual(args[2]!.defaultValue, 'user')
    })

    it('captures inline description on argument', () => {
      const { args } = parseSignature('cmd {name : The user name}')
      assert.strictEqual(args[0]!.name, 'name')
      assert.strictEqual(args[0]!.required, true)
      assert.strictEqual(args[0]!.description, 'The user name')
    })

    it('captures description on optional argument with default', () => {
      const { args } = parseSignature('cmd {env=local : Target environment}')
      assert.strictEqual(args[0]!.name, 'env')
      assert.strictEqual(args[0]!.defaultValue, 'local')
      assert.strictEqual(args[0]!.description, 'Target environment')
    })
  })

  describe('options', () => {
    it('parses a boolean flag', () => {
      const { opts } = parseSignature('cmd {--force}')
      assert.deepStrictEqual(opts, [{ name: 'force', hasValue: false }])
    })

    it('parses an option that accepts a value', () => {
      const { opts } = parseSignature('cmd {--role=}')
      assert.deepStrictEqual(opts, [{ name: 'role', hasValue: true }])
    })

    it('parses an option with a default value', () => {
      const { opts } = parseSignature('cmd {--env=local}')
      assert.deepStrictEqual(opts, [{ name: 'env', hasValue: true, defaultValue: 'local' }])
    })

    it('parses shorthand option {--N|name=}', () => {
      const { opts } = parseSignature('cmd {--N|name=}')
      assert.deepStrictEqual(opts, [{ name: 'name', shorthand: 'N', hasValue: true }])
    })

    it('captures inline description on option', () => {
      const { opts } = parseSignature('cmd {--force : Force overwrite}')
      assert.strictEqual(opts[0]!.name, 'force')
      assert.strictEqual(opts[0]!.hasValue, false)
      assert.strictEqual(opts[0]!.description, 'Force overwrite')
    })

    it('captures description on option with value and default', () => {
      const { opts } = parseSignature('cmd {--queue=default : Queue to dispatch on}')
      assert.strictEqual(opts[0]!.name, 'queue')
      assert.strictEqual(opts[0]!.hasValue, true)
      assert.strictEqual(opts[0]!.defaultValue, 'default')
      assert.strictEqual(opts[0]!.description, 'Queue to dispatch on')
    })

    it('parses a mix of args and options', () => {
      const parsed = parseSignature('users:create {name} {email?} {--force} {--role=admin}')
      assert.strictEqual(parsed.name, 'users:create')
      assert.strictEqual(parsed.args.length, 2)
      assert.strictEqual(parsed.opts.length, 2)
      assert.strictEqual(parsed.opts[1]!.defaultValue, 'admin')
    })
  })
})

// ─── Command class ────────────────────────────────────────

describe('Command', () => {
  class TestCommand extends Command {
    readonly signature = 'test {name} {--force}'
    readonly description = 'Test command'
    handle(): void {}
  }

  it('_setContext + argument() returns the argument value', () => {
    const cmd = new TestCommand()
    cmd._setContext({ name: 'Alice' }, {})
    assert.strictEqual(cmd.argument('name'), 'Alice')
  })

  it('argument() returns empty string for missing keys', () => {
    const cmd = new TestCommand()
    cmd._setContext({}, {})
    assert.strictEqual(cmd.argument('missing'), '')
  })

  it('arguments() returns a shallow copy of all args', () => {
    const cmd = new TestCommand()
    const original = { name: 'Alice' }
    cmd._setContext(original, {})
    const copy = cmd.arguments()
    assert.deepStrictEqual(copy, { name: 'Alice' })
    // Mutation of returned object doesn't affect internal state
    copy['name'] = 'Bob'
    assert.strictEqual(cmd.argument('name'), 'Alice')
  })

  it('option() returns the option value', () => {
    const cmd = new TestCommand()
    cmd._setContext({}, { force: true })
    assert.strictEqual(cmd.option('force'), true)
  })

  it('option() returns undefined for missing options', () => {
    const cmd = new TestCommand()
    cmd._setContext({}, {})
    assert.strictEqual(cmd.option('missing'), undefined)
  })

  it('options() returns a shallow copy of all opts', () => {
    const cmd = new TestCommand()
    const original = { force: true }
    cmd._setContext({}, original)
    const copy = cmd.options()
    assert.deepStrictEqual(copy, { force: true })
    copy['force'] = false
    assert.strictEqual(cmd.option('force'), true)
  })

  describe('output helpers', () => {
    it('info() calls console.log with green ANSI', () => {
      const cmd = new TestCommand()
      const logs: string[] = []
      const originalLog = console.log
      console.log = (msg: string) => logs.push(msg)
      try {
        cmd.info('Hello')
        assert.ok(logs[0]!.includes('Hello'))
        assert.ok(logs[0]!.includes('\x1b[32m'))
      } finally {
        console.log = originalLog
      }
    })

    it('error() calls console.error with red ANSI', () => {
      const cmd = new TestCommand()
      const logs: string[] = []
      const originalError = console.error
      console.error = (msg: string) => logs.push(msg)
      try {
        cmd.error('Oops')
        assert.ok(logs[0]!.includes('Oops'))
        assert.ok(logs[0]!.includes('\x1b[31m'))
      } finally {
        console.error = originalError
      }
    })

    it('warn() calls console.warn with yellow ANSI', () => {
      const cmd = new TestCommand()
      const logs: string[] = []
      const originalWarn = console.warn
      console.warn = (msg: string) => logs.push(msg)
      try {
        cmd.warn('Watch out')
        assert.ok(logs[0]!.includes('Watch out'))
        assert.ok(logs[0]!.includes('\x1b[33m'))
      } finally {
        console.warn = originalWarn
      }
    })

    it('line() calls console.log with the raw message', () => {
      const cmd = new TestCommand()
      const logs: string[] = []
      const originalLog = console.log
      console.log = (msg: string) => logs.push(msg)
      try {
        cmd.line('plain text')
        assert.strictEqual(logs[0], 'plain text')
      } finally {
        console.log = originalLog
      }
    })

    it('line() defaults to empty string', () => {
      const cmd = new TestCommand()
      const logs: string[] = []
      const originalLog = console.log
      console.log = (msg: string) => logs.push(msg)
      try {
        cmd.line()
        assert.strictEqual(logs[0], '')
      } finally {
        console.log = originalLog
      }
    })

    it('comment() calls console.log with dim ANSI', () => {
      const cmd = new TestCommand()
      const logs: string[] = []
      const originalLog = console.log
      console.log = (msg: string) => logs.push(msg)
      try {
        cmd.comment('subtle note')
        assert.ok(logs[0]!.includes('subtle note'))
        assert.ok(logs[0]!.includes('\x1b[2m'))
      } finally {
        console.log = originalLog
      }
    })

    it('newLine() logs an empty line by default', () => {
      const cmd = new TestCommand()
      const logs: string[] = []
      const originalLog = console.log
      console.log = (msg: string) => logs.push(msg)
      try {
        cmd.newLine()
        // count-1 repetitions: newLine(1) → '\n'.repeat(0) = ''
        assert.strictEqual(logs[0], '')
      } finally {
        console.log = originalLog
      }
    })
  })

  describe('table()', () => {
    it('renders a separator + header + rows', () => {
      const cmd = new TestCommand()
      const logs: string[] = []
      const originalLog = console.log
      console.log = (msg: string) => logs.push(msg)
      try {
        cmd.table(['Name', 'Email'], [['Alice', 'alice@example.com'], ['Bob', 'bob@example.com']])
        // sep, header, sep, row1, row2, sep
        assert.strictEqual(logs.length, 6)
        assert.ok(logs[1]!.includes('Name'))
        assert.ok(logs[1]!.includes('Email'))
        assert.ok(logs[3]!.includes('Alice'))
        assert.ok(logs[4]!.includes('Bob'))
      } finally {
        console.log = originalLog
      }
    })

    it('handles ragged rows (fewer columns than headers)', () => {
      const cmd = new TestCommand()
      const logs: string[] = []
      const originalLog = console.log
      console.log = (msg: string) => logs.push(msg)
      try {
        cmd.table(['A', 'B', 'C'], [['x'], ['y', 'z']])
        // Should not throw; missing cells appear as empty strings
        assert.ok(logs[3]!.includes('x'))
        assert.ok(logs[4]!.includes('y'))
        assert.ok(logs[4]!.includes('z'))
      } finally {
        console.log = originalLog
      }
    })

    it('columns are padded to the width of the longest value', () => {
      const cmd = new TestCommand()
      const logs: string[] = []
      const originalLog = console.log
      console.log = (msg: string) => logs.push(msg)
      try {
        cmd.table(['ID'], [['1'], ['100']])
        // Header row: " ID " padded to width 3 (length of '100')
        assert.ok(logs[1]!.includes(' ID '))
      } finally {
        console.log = originalLog
      }
    })
  })

  describe('CancelledError', () => {
    it('is an instance of Error', () => {
      const err = new CancelledError()
      assert.ok(err instanceof Error)
      assert.ok(err instanceof CancelledError)
    })

    it('has name CancelledError', () => {
      assert.strictEqual(new CancelledError().name, 'CancelledError')
    })

    it('accepts a custom message', () => {
      assert.strictEqual(new CancelledError('User quit').message, 'User quit')
    })

    it('defaults to Cancelled.', () => {
      assert.strictEqual(new CancelledError().message, 'Cancelled.')
    })
  })
})
