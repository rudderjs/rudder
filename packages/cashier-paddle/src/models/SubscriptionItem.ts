import { Model } from '@rudderjs/orm'

/** Line item on a Paddle subscription (price × quantity).
 *  `static table` = the SQL table name (runs on native + Prisma; see
 *  `Customer.ts`). `keyType = 'ulid'` stamps the id on insert. */
export class SubscriptionItem extends Model {
  static override table = 'paddle_subscription_items'
  static override keyType = 'ulid' as const

  static override fillable = [
    'subscriptionId', 'productId', 'priceId', 'status', 'quantity',
  ]

  declare id:             string
  declare subscriptionId: string
  declare productId:      string
  declare priceId:        string
  declare status:         string
  declare quantity:       number
  declare createdAt:      Date
  declare updatedAt:      Date
}
