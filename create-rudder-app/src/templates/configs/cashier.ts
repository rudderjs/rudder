export function configCashier(): string {
  return `import { Env } from '@rudderjs/core'
import type { CashierConfig } from '@rudderjs/cashier-paddle'

// Paddle billing via @rudderjs/cashier-paddle. Uses Paddle Billing v2 API.
// Get an API key + Client-side token from your Paddle dashboard:
//   https://vendors.paddle.com/authentication
//
// Webhook secret is the per-notification-destination signing secret —
// configure a webhook in Paddle pointing to /paddle/webhook and copy the secret.
export default {
  apiKey:           Env.get('PADDLE_API_KEY', ''),
  clientSideToken:  Env.get('PADDLE_CLIENT_SIDE_TOKEN', ''),
  webhookSecret:    Env.get('PADDLE_WEBHOOK_SECRET', ''),
  sandbox:          Env.getBool('PADDLE_SANDBOX', true),
  webhookPath:      '/paddle/webhook',
  currency:         'USD',
  currencyLocale:   'en',
} satisfies CashierConfig
`
}
