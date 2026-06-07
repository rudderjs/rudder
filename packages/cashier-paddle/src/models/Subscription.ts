import { Model } from '@rudderjs/orm'

/**
 * Paddle subscription. Created by webhook handlers, updated by webhook handlers
 * and by `SubscriptionResource` mutations.
 *
 * `paddleStatus` mirrors Paddle's status string (`active`, `trialing`,
 * `past_due`, `paused`, `canceled`).
 *
 * NOTE: `static table` = the SQL table name (runs on native + Prisma; see
 * `Customer.ts`). `keyType = 'ulid'` stamps the id on insert.
 * NOTE: Use `subscriptionHelpers` from `models/helpers.ts` for state predicates;
 * ORM queries return plain records without prototype.
 */
export class Subscription extends Model {
  static override table = 'paddle_subscriptions'
  static override keyType = 'ulid' as const

  static override fillable = [
    'billableId', 'billableType', 'type', 'paddleId', 'paddleStatus',
    'paddleProductId', 'trialEndsAt', 'pausedAt', 'endsAt',
  ]

  declare id:               string
  declare billableId:       string
  declare billableType:     string
  declare type:             string
  declare paddleId:         string
  declare paddleStatus:     string
  declare paddleProductId:  string | null
  declare trialEndsAt:      Date | null
  declare pausedAt:         Date | null
  declare endsAt:           Date | null
  declare createdAt:        Date
  declare updatedAt:        Date
}
