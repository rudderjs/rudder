import type { PassportConfig } from '@rudderjs/passport'

export default {
  // Keys loaded from filesystem — run `pnpm rudder passport:keys` to generate
  keyPath: 'storage',

  // Token lifetimes
  tokensExpireIn:               15 * 24 * 60 * 60 * 1000,          // 15 days
  refreshTokensExpireIn:        30 * 24 * 60 * 60 * 1000,          // 30 days
  personalAccessTokensExpireIn: 6 * 30 * 24 * 60 * 60 * 1000,      // ~6 months

  // Available OAuth scopes
  scopes: {
    read:  'Read access to your data',
    write: 'Modify your data',
    admin: 'Full administrative access',
  },
} satisfies PassportConfig
