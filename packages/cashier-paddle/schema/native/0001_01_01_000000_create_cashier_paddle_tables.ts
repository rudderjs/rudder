import { Migration, Schema } from '@rudderjs/orm/native'

// @rudderjs/cashier-paddle tables (mirror Laravel Cashier Paddle 13.x).
// Published by `pnpm rudder vendor:publish --tag=cashier-schema` on
// native-engine apps (the Prisma twin lives in ../cashier-paddle.prisma).
//
// SQL table names match the prisma fragment's `@@map` names so one set of
// models runs on both engines (orm-prisma maps the SQL name → delegate). The
// `id` is a string ulid: the models set `static keyType = 'ulid'` so the ORM
// stamps the key on insert (the native engine has no `@default(cuid())`).
export default class extends Migration {
  async up() {
    await Schema.create('paddle_customers', (t) => {
      t.ulid('id').primary()
      t.string('paddleId').nullable().unique()
      t.string('billableId')
      t.string('billableType')
      t.string('name').nullable()
      t.string('email').nullable()
      t.dateTime('trialEndsAt').nullable()
      t.dateTime('createdAt').useCurrent()
      t.dateTime('updatedAt').useCurrent()
      t.unique(['billableType', 'billableId'])
    })

    await Schema.create('paddle_subscriptions', (t) => {
      t.ulid('id').primary()
      t.string('billableId')
      t.string('billableType')
      t.string('type').default('default')
      t.string('paddleId').unique()
      t.string('paddleStatus').index()
      t.string('paddleProductId').nullable()
      t.dateTime('trialEndsAt').nullable()
      t.dateTime('pausedAt').nullable()
      t.dateTime('endsAt').nullable()
      t.dateTime('createdAt').useCurrent()
      t.dateTime('updatedAt').useCurrent()
      t.index(['billableType', 'billableId'])
    })

    await Schema.create('paddle_subscription_items', (t) => {
      t.ulid('id').primary()
      t.string('subscriptionId')
      t.string('productId')
      t.string('priceId')
      t.string('status')
      t.integer('quantity').default(1)
      t.dateTime('createdAt').useCurrent()
      t.dateTime('updatedAt').useCurrent()
      t.unique(['subscriptionId', 'priceId'])
    })

    await Schema.create('paddle_transactions', (t) => {
      t.ulid('id').primary()
      t.string('paddleId').unique()
      t.string('paddleCustomerId').nullable().index()
      t.string('paddleSubscriptionId').nullable()
      t.string('billableId')
      t.string('billableType')
      t.string('invoiceNumber').nullable()
      t.string('status')
      t.string('total')
      t.string('tax').default('0')
      t.string('currency')
      t.dateTime('billedAt').nullable()
      t.dateTime('createdAt').useCurrent()
      t.dateTime('updatedAt').useCurrent()
      t.index(['billableType', 'billableId'])
    })

    await Schema.create('paddle_webhook_logs', (t) => {
      t.ulid('id').primary()
      t.string('eventId').unique()
      t.string('eventType').index()
      t.dateTime('processedAt').useCurrent()
    })
  }

  async down() {
    await Schema.dropIfExists('paddle_webhook_logs')
    await Schema.dropIfExists('paddle_transactions')
    await Schema.dropIfExists('paddle_subscription_items')
    await Schema.dropIfExists('paddle_subscriptions')
    await Schema.dropIfExists('paddle_customers')
  }
}
