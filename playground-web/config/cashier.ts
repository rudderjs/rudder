import { Env } from '@rudderjs/core'
import type { CashierConfig } from '@rudderjs/cashier-paddle'

export default {
  apiKey:           Env.get('PADDLE_API_KEY', ''),
  clientSideToken:  Env.get('PADDLE_CLIENT_SIDE_TOKEN', ''),
  webhookSecret:    Env.get('PADDLE_WEBHOOK_SECRET', ''),
  sandbox:          Env.get('PADDLE_SANDBOX', 'true') === 'true',
  webhookPath:      '/paddle/webhook',
  currency:         'USD',
  currencyLocale:   Env.get('CASHIER_CURRENCY_LOCALE', 'en'),
} satisfies CashierConfig
