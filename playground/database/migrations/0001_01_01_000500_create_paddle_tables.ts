import { Migration, Schema } from '@rudderjs/orm/native'

// @rudderjs/cashier-paddle tables (mirror Laravel Cashier Paddle 13.x).
// Delegate-style table names for the same reason as the oauth tables.
export default class extends Migration {
  async up() {
    await Schema.create('paddleCustomer', (t) => {
      t.id()
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

    await Schema.create('paddleSubscription', (t) => {
      t.id()
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

    await Schema.create('paddleSubscriptionItem', (t) => {
      t.id()
      t.string('subscriptionId')
      t.string('productId')
      t.string('priceId')
      t.string('status')
      t.integer('quantity').default(1)
      t.dateTime('createdAt').useCurrent()
      t.dateTime('updatedAt').useCurrent()
      t.unique(['subscriptionId', 'priceId'])
    })

    await Schema.create('paddleTransaction', (t) => {
      t.id()
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

    await Schema.create('paddleWebhookLog', (t) => {
      t.id()
      t.string('eventId').unique()
      t.string('eventType').index()
      t.dateTime('processedAt').useCurrent()
    })
  }

  async down() {
    await Schema.dropIfExists('paddleWebhookLog')
    await Schema.dropIfExists('paddleTransaction')
    await Schema.dropIfExists('paddleSubscriptionItem')
    await Schema.dropIfExists('paddleSubscription')
    await Schema.dropIfExists('paddleCustomer')
  }
}
