import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { MailRegistry, Mailable, type MailAdapter } from '@rudderjs/mail'
import { ModelRegistry, type OrmAdapter } from '@rudderjs/orm'
import {
  ChannelRegistry,
  MailChannel,
  DatabaseChannel,
  Notifier,
  Notification,
  notify,
  NotificationProvider,
  type Notifiable,
  type NotificationChannel,
} from './index.js'

// ─── Helpers ───────────────────────────────────────────────

class BasicMail extends Mailable {
  build() { return this.subject('Hello').text('World') }
}

class MailNotification extends Notification {
  via(): string[] { return ['mail'] }
  toMail(): Mailable { return new BasicMail() }
}

class DbNotification extends Notification {
  via(): string[] { return ['database'] }
  toDatabase(): Record<string, unknown> { return { message: 'hello' } }
}

class MultiChannelNotification extends Notification {
  via(): string[] { return ['mail', 'database'] }
  toMail(): Mailable { return new BasicMail() }
  toDatabase(): Record<string, unknown> { return { kind: 'multi' } }
}

const user: Notifiable = { id: '1', email: 'alice@example.com', name: 'Alice' }
const userNoEmail: Notifiable = { id: '2' }

const fakeApp = { instance: () => undefined } as never

function makeOrmAdapter(created: unknown[]): OrmAdapter {
  const qb: any = {
    where:    () => qb,
    orWhere:  () => qb,
    orderBy:  () => qb,
    limit:    () => qb,
    offset:   () => qb,
    with:     () => qb,
    first:    async () => null,
    find:     async () => null,
    get:      async () => [],
    all:      async () => [],
    count:    async () => 0,
    create:   async (data: unknown) => { created.push(data); return data },
    update:   async () => ({}),
    delete:   async () => undefined,
    paginate: async () => ({ data: [], total: 0, perPage: 15, currentPage: 1, lastPage: 0, from: 0, to: 0 }),
  }
  return { query: () => qb, connect: async () => undefined, disconnect: async () => undefined }
}

function resetModelRegistry(): void {
  ;(ModelRegistry as unknown as { adapter: null }).adapter = null
}

function makeSendingMailAdapter(sent: unknown[]): MailAdapter {
  return { send: async (mailable, options) => { sent.push({ mailable, options }) } }
}

// ─── ChannelRegistry ───────────────────────────────────────

describe('ChannelRegistry', () => {
  beforeEach(() => ChannelRegistry.reset())

  it('has() returns false for unregistered channel', () => {
    assert.strictEqual(ChannelRegistry.has('sms'), false)
  })

  it('get() returns undefined for unregistered channel', () => {
    assert.strictEqual(ChannelRegistry.get('sms'), undefined)
  })

  it('register() + get() + has() work correctly', () => {
    const channel: NotificationChannel = { send: async () => {} }
    ChannelRegistry.register('custom', channel)
    assert.strictEqual(ChannelRegistry.has('custom'), true)
    assert.strictEqual(ChannelRegistry.get('custom'), channel)
  })

  it('register() overwrites an existing channel by name', () => {
    const a: NotificationChannel = { send: async () => {} }
    const b: NotificationChannel = { send: async () => {} }
    ChannelRegistry.register('ch', a)
    ChannelRegistry.register('ch', b)
    assert.strictEqual(ChannelRegistry.get('ch'), b)
  })

  it('reset() removes all channels', () => {
    ChannelRegistry.register('mail', new MailChannel())
    ChannelRegistry.reset()
    assert.strictEqual(ChannelRegistry.has('mail'), false)
  })
})

// ─── MailChannel ───────────────────────────────────────────

describe('MailChannel', () => {
  let sent: unknown[]

  beforeEach(() => {
    sent = []
    MailRegistry.reset()
  })

  it('throws when notification has no toMail()', async () => {
    class NoMailMethod extends Notification {
      via() { return ['mail'] }
    }
    await assert.rejects(
      () => new MailChannel().send(user, new NoMailMethod()),
      /does not implement toMail/
    )
  })

  it('throws when no mail adapter is registered', async () => {
    await assert.rejects(
      () => new MailChannel().send(user, new MailNotification()),
      /No mail adapter registered/
    )
  })

  it('throws when notifiable has no email', async () => {
    MailRegistry.set(makeSendingMailAdapter(sent))
    await assert.rejects(
      () => new MailChannel().send(userNoEmail, new MailNotification()),
      /has no email address/
    )
  })

  it('sends mail to the notifiable email address', async () => {
    MailRegistry.set(makeSendingMailAdapter(sent))
    MailRegistry.setFrom({ address: 'noreply@example.com' })
    await new MailChannel().send(user, new MailNotification())
    assert.strictEqual(sent.length, 1)
    assert.deepStrictEqual((sent[0] as any).options.to, ['alice@example.com'])
  })

  it('uses the from address from MailRegistry', async () => {
    MailRegistry.set(makeSendingMailAdapter(sent))
    MailRegistry.setFrom({ address: 'app@example.com', name: 'App' })
    await new MailChannel().send(user, new MailNotification())
    assert.deepStrictEqual((sent[0] as any).options.from, { address: 'app@example.com', name: 'App' })
  })

  it('supports async toMail()', async () => {
    MailRegistry.set(makeSendingMailAdapter(sent))
    class AsyncMailNotification extends Notification {
      via() { return ['mail'] }
      async toMail() { await Promise.resolve(); return new BasicMail() }
    }
    await assert.doesNotReject(() => new MailChannel().send(user, new AsyncMailNotification()))
    assert.strictEqual(sent.length, 1)
  })
})

// ─── DatabaseChannel ───────────────────────────────────────

describe('DatabaseChannel', () => {
  let created: unknown[]

  beforeEach(() => {
    created = []
    resetModelRegistry()
  })

  it('throws when notification has no toDatabase()', async () => {
    class NoDbMethod extends Notification {
      via() { return ['database'] }
    }
    await assert.rejects(
      () => new DatabaseChannel().send(user, new NoDbMethod()),
      /does not implement toDatabase/
    )
  })

  it('throws when no ORM adapter is registered', async () => {
    await assert.rejects(
      () => new DatabaseChannel().send(user, new DbNotification()),
      /No ORM adapter registered/
    )
  })

  it('creates a row with correct fields', async () => {
    ModelRegistry.set(makeOrmAdapter(created))
    await new DatabaseChannel().send(user, new DbNotification())
    assert.strictEqual(created.length, 1)
    const row = created[0] as Record<string, unknown>
    assert.strictEqual(row.notifiable_id, '1')
    assert.strictEqual(row.notifiable_type, 'users')
    assert.strictEqual(row.type, 'DbNotification')
    assert.strictEqual(row.data, JSON.stringify({ message: 'hello' }))
    assert.ok(typeof row.created_at === 'string')
    assert.ok(typeof row.updated_at === 'string')
    assert.strictEqual(row.read_at, null)
  })

  it('stringifies notifiable.id when it is a number', async () => {
    ModelRegistry.set(makeOrmAdapter(created))
    await new DatabaseChannel().send({ id: 42 }, new DbNotification())
    assert.strictEqual((created[0] as Record<string, unknown>).notifiable_id, '42')
  })

  it('supports async toDatabase()', async () => {
    ModelRegistry.set(makeOrmAdapter(created))
    class AsyncDbNotification extends Notification {
      via() { return ['database'] }
      async toDatabase() { await Promise.resolve(); return { async: true } }
    }
    await new DatabaseChannel().send(user, new AsyncDbNotification())
    assert.strictEqual((created[0] as Record<string, unknown>).data, '{"async":true}')
  })

  it('uses "notification" as the default table name (Prisma delegate convention)', () => {
    // The default matches Prisma's client delegate (camelCase singular of the
    // Notification model), not the SQL table name. Apps using a non-Prisma
    // adapter that needs the plural SQL name should subclass and override.
    const ch = new DatabaseChannel()
    assert.strictEqual((ch as any).table, 'notification')
  })
})

// ─── Notifier ──────────────────────────────────────────────

describe('Notifier', () => {
  let sent:    unknown[]
  let created: unknown[]

  beforeEach(() => {
    sent    = []
    created = []
    ChannelRegistry.reset()
    MailRegistry.reset()
    resetModelRegistry()
    MailRegistry.set(makeSendingMailAdapter(sent))
    MailRegistry.setFrom({ address: 'noreply@example.com' })
    ModelRegistry.set(makeOrmAdapter(created))
    ChannelRegistry.register('mail',     new MailChannel())
    ChannelRegistry.register('database', new DatabaseChannel())
  })

  it('throws for an unknown channel', async () => {
    await assert.rejects(
      () => Notifier.send(user, new class extends Notification { via() { return ['sms'] } }),
      /Unknown channel "sms"/
    )
  })

  it('sends via a single channel', async () => {
    await Notifier.send(user, new MailNotification())
    assert.strictEqual(sent.length, 1)
  })

  it('sends via multiple channels', async () => {
    await Notifier.send(user, new MultiChannelNotification())
    assert.strictEqual(sent.length, 1)
    assert.strictEqual(created.length, 1)
  })

  it('sends to multiple notifiables', async () => {
    const user2: Notifiable = { id: '2', email: 'bob@example.com' }
    await Notifier.send([user, user2], new MailNotification())
    assert.strictEqual(sent.length, 2)
  })

  it('single notifiable can be passed directly (not in array)', async () => {
    await Notifier.send(user, new MailNotification())
    assert.strictEqual(sent.length, 1)
  })

  it('sends nothing when via() returns empty array', async () => {
    class SilentNotification extends Notification {
      via() { return [] }
    }
    await assert.doesNotReject(() => Notifier.send(user, new SilentNotification()))
    assert.strictEqual(sent.length, 0)
  })
})

// ─── notify() helper ───────────────────────────────────────

describe('notify()', () => {
  beforeEach(() => {
    ChannelRegistry.reset()
    MailRegistry.reset()
    MailRegistry.set({ send: async () => {} })
    MailRegistry.setFrom({ address: 'noreply@example.com' })
    ChannelRegistry.register('mail', new MailChannel())
  })

  it('is an alias for Notifier.send()', async () => {
    await assert.doesNotReject(() => notify(user, new MailNotification()))
  })

  it('accepts multiple notifiables', async () => {
    const calls: unknown[] = []
    ChannelRegistry.reset()
    ChannelRegistry.register('mail', { send: async (n) => { calls.push(n.id) } })
    await notify([{ id: '1', email: 'a@b.com' }, { id: '2', email: 'b@b.com' }], new MailNotification())
    assert.deepStrictEqual(calls.sort(), ['1', '2'])
  })
})

// ─── NotificationProvider ──────────────────────────────────

describe('NotificationProvider', () => {
  beforeEach(() => ChannelRegistry.reset())

  it('registers mail and database channels', () => {
    new NotificationProvider(fakeApp).boot?.()
    assert.ok(ChannelRegistry.get('mail') instanceof MailChannel)
    assert.ok(ChannelRegistry.get('database') instanceof DatabaseChannel)
  })

  it('register() does not throw', () => {
    assert.doesNotThrow(() => new NotificationProvider(fakeApp).register?.())
  })

  it('channels are replaced on subsequent boots', () => {
    new NotificationProvider(fakeApp).boot?.()
    new NotificationProvider(fakeApp).boot?.()
    assert.ok(ChannelRegistry.has('mail'))
    assert.ok(ChannelRegistry.has('database'))
  })
})

// ─── Schema files ─────────────────────────────────────────

import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const schemaDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'schema')

describe('notification schema files', () => {
  it('ships notification.prisma with Notification model', () => {
    const file = join(schemaDir, 'notification.prisma')
    assert.ok(existsSync(file), 'notification.prisma should exist')
    const content = readFileSync(file, 'utf8')
    assert.ok(content.includes('model Notification'), 'should contain Notification model')
  })

  it('ships drizzle schemas for all 3 drivers', () => {
    for (const variant of ['sqlite', 'pg', 'mysql']) {
      const file = join(schemaDir, `notification.drizzle.${variant}.ts`)
      assert.ok(existsSync(file), `notification.drizzle.${variant}.ts should exist`)
      const content = readFileSync(file, 'utf8')
      assert.ok(content.includes('export const notification'), `${variant}: should export notification`)
    }
  })

  it('sqlite schema imports from sqlite-core', () => {
    const content = readFileSync(join(schemaDir, 'notification.drizzle.sqlite.ts'), 'utf8')
    assert.ok(content.includes('drizzle-orm/sqlite-core'))
  })

  it('pg schema imports from pg-core', () => {
    const content = readFileSync(join(schemaDir, 'notification.drizzle.pg.ts'), 'utf8')
    assert.ok(content.includes('drizzle-orm/pg-core'))
  })

  it('mysql schema imports from mysql-core', () => {
    const content = readFileSync(join(schemaDir, 'notification.drizzle.mysql.ts'), 'utf8')
    assert.ok(content.includes('drizzle-orm/mysql-core'))
  })
})
