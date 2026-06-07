import { Model } from '@rudderjs/orm'

/** Idempotency log — one row per processed Paddle event id.
 *  `static table` = the SQL table name (runs on native + Prisma; see
 *  `Customer.ts`). `keyType = 'ulid'` stamps the id on insert. */
export class WebhookLog extends Model {
  static override table = 'paddle_webhook_logs'
  static override keyType = 'ulid' as const

  static override fillable = ['eventId', 'eventType', 'processedAt']

  declare eventId:     string
  declare eventType:   string
  declare processedAt: Date
}
