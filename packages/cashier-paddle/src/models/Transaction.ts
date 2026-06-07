import { Model } from '@rudderjs/orm'

/**
 * Paddle transaction (invoice/order). Amounts stored as strings in *minor units*
 * — never `Number()` for arithmetic. Use `formatAmount()` for display.
 *
 * `static table` = the SQL table name (runs on native + Prisma; see
 * `Customer.ts`). `keyType = 'ulid'` stamps the id on insert.
 */
export class Transaction extends Model {
  static override table = 'paddle_transactions'
  static override keyType = 'ulid' as const

  static override fillable = [
    'paddleId', 'paddleCustomerId', 'paddleSubscriptionId',
    'billableId', 'billableType', 'invoiceNumber', 'status',
    'total', 'tax', 'currency', 'billedAt',
  ]

  declare id:                   string
  declare paddleId:             string
  declare paddleCustomerId:     string | null
  declare paddleSubscriptionId: string | null
  declare billableId:           string
  declare billableType:         string
  declare invoiceNumber:        string | null
  declare status:               string
  declare total:                string
  declare tax:                  string
  declare currency:             string
  declare billedAt:             Date | null
  declare createdAt:            Date
  declare updatedAt:            Date
}
