import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { artisan, Command, parseSignature } from './index.js'

describe('Artisan contract baseline', () => {
  beforeEach(() => {
    artisan.reset()
  })

  it('artisan.command() registers a command', () => {
    const name = `test:hello:${Date.now()}`
    artisan.command(name, () => undefined)

    const found = artisan.getCommands().find(c => c.name === name)
    assert.ok(found)
  })

  it('artisan.register() registers class-based commands', () => {
    class HelloCommand extends Command {
      readonly signature = 'hello'
      readonly description = 'hello cmd'
      handle(): void {}
    }

    artisan.register(HelloCommand)

    assert.deepStrictEqual(artisan.getClasses(), [HelloCommand])
  })

  it('artisan.reset() clears registered commands and classes', () => {
    class A extends Command {
      readonly signature = 'a'
      readonly description = 'a'
      handle(): void {}
    }

    artisan.command('x', () => undefined)
    artisan.register(A)
    artisan.reset()

    assert.strictEqual(artisan.getCommands().length, 0)
    assert.strictEqual(artisan.getClasses().length, 0)
  })

  it('parseSignature parses required and optional arguments', () => {
    const parsed = parseSignature('users:create {name} {email?}')

    assert.strictEqual(parsed.name, 'users:create')
    assert.deepStrictEqual(parsed.args, [
      { name: 'name', required: true, variadic: false },
      { name: 'email', required: false, variadic: false },
    ])
  })

  it('parseSignature parses options with and without values', () => {
    const parsed = parseSignature('users:create {--force} {--role=}')

    assert.deepStrictEqual(parsed.opts, [
      { name: 'force', hasValue: false },
      { name: 'role', hasValue: true },
    ])
  })

  it('parseSignature parses shorthand options', () => {
    const parsed = parseSignature('users:create {--N|name=}')

    assert.deepStrictEqual(parsed.opts, [
      { name: 'name', shorthand: 'N', hasValue: true },
    ])
  })
})
