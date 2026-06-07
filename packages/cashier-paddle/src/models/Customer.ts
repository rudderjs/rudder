import { Model } from '@rudderjs/orm'

/**
 * Paddle customer — joins your billable model to Paddle's customer record.
 *
 * NOTE: `static table` is the **SQL table name** (`@@map`), so the model runs
 * unchanged on the native engine AND on Prisma (the orm-prisma adapter maps the
 * SQL name back to its `paddleCustomer` delegate via the runtime datamodel).
 * `keyType = 'ulid'` makes the ORM stamp an application-generated id on insert
 * (the native engine has no `@default(cuid())`); on Prisma, new rows get a ulid
 * instead of a cuid — both are opaque strings, so old cuid rows coexist.
 *
 * NOTE: ORM queries return plain records, NOT Model instances. Treat instance
 * methods on this class as documentation; for runtime behavior use the helpers
 * in `models/helpers.ts` (`customerHelpers.*`).
 */
export class Customer extends Model {
  static override table = 'paddle_customers'
  static override keyType = 'ulid' as const

  static override fillable = [
    'paddleId', 'billableId', 'billableType', 'name', 'email', 'trialEndsAt',
  ]

  declare id:           string
  declare paddleId:     string | null
  declare billableId:   string
  declare billableType: string
  declare name:         string | null
  declare email:        string | null
  declare trialEndsAt:  Date | null
  declare createdAt:    Date
  declare updatedAt:    Date
}
