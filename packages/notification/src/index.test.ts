import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { MailRegistry, Mailable, type MailAdapter } from '@boostkit/mail'
import { ModelRegistry, type OrmAdapter, type QueryBuilder } from '@boostkit/core'
import {
  ChannelRegistry,
  Notifier,
  Notification,
  MailChannel,
  DatabaseChannel,
  type NotificationChannel,
} from './index.js'

describe('Notification contract baseline', () => {
  beforeEach(() => {
    ;(ChannelRegistry as unknown as { channels: Map<string, NotificationChannel> }).channels.clear()
    ;(MailRegistry as unknown as { adapter: MailAdapter | null }).adapter = null
    ;(ModelRegistry as unknown as { adapter: OrmAdapter | null }).adapter = null
  })

  it('ChannelRegistry register/get/has behaves correctly', () => {
    const channel: NotificationChannel = { send: async () => undefined }

    ChannelRegistry.register('custom', channel)

    assert.strictEqual(ChannelRegistry.has('custom'), true)
    assert.strictEqual(ChannelRegistry.get('custom'), channel)
    assert.strictEqual(ChannelRegistry.has('missing'), false)
  })

  it('Notifier.send() throws for unknown channel', async () => {
    class SmsNotification extends Notification {
      via(): string[] { return ['sms'] }
    }

    await assert.rejects(
      () => Notifier.send({ id: '1' }, new SmsNotification()),
      /Unknown channel "sms"/
    )
  })

  it('MailChannel.send() throws when no mail adapter is registered', async () => {
    class BasicMail extends Mailable {
      build() { return this.subject('Subject').text('Body') }
    }
    class MailNotification extends Notification {
      via(): string[] { return ['mail'] }
      toMail(): Mailable { return new BasicMail() }
    }

    await assert.rejects(
      () => new MailChannel().send({ id: '1', email: 'a@example.com' }, new MailNotification()),
      /No mail adapter registered/
    )
  })

  it('DatabaseChannel.send() throws when no ORM adapter is registered', async () => {
    class DbNotification extends Notification {
      via(): string[] { return ['database'] }
      toDatabase(): Record<string, unknown> { return { message: 'hello' } }
    }

    await assert.rejects(
      () => new DatabaseChannel().send({ id: '1' }, new DbNotification()),
      /No ORM adapter registered/
    )
  })

  it('DatabaseChannel.send() writes notification when adapter is present', async () => {
    const created: unknown[] = []
    const qb: QueryBuilder<Record<string, unknown>> = {
      where: () => qb,
      orWhere: () => qb,
      orderBy: () => qb,
      limit: () => qb,
      offset: () => qb,
      with: () => qb,
      first: async () => null,
      find: async () => null,
      get: async () => [],
      all: async () => [],
      count: async () => 0,
      create: async (data) => { created.push(data); return data as Record<string, unknown> },
      update: async () => ({}),
      delete: async () => undefined,
      paginate: async () => ({ data: [], total: 0, perPage: 15, currentPage: 1, lastPage: 0, from: 0, to: 0 }),
    }
    ModelRegistry.set({ query: () => qb, connect: async () => undefined, disconnect: async () => undefined } as OrmAdapter)

    class DbNotification extends Notification {
      via(): string[] { return ['database'] }
      toDatabase(): Record<string, unknown> { return { kind: 'welcome' } }
    }

    await new DatabaseChannel().send({ id: 7 }, new DbNotification())

    assert.strictEqual(created.length, 1)
    assert.strictEqual(typeof (created[0] as Record<string, unknown>).type, 'string')
  })
})
