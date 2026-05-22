export function configSanctum(): string {
  return `import type { SanctumConfig } from '@rudderjs/sanctum'

// API tokens via @rudderjs/sanctum. Tokens are SHA-256 hashed on the server,
// scoped via abilities, and verified through Auth's TokenGuard.
//
// Issue tokens with \`user.createToken('name', ['ability:*'])\` in a controller,
// gate routes with \`RequireBearer()\` + \`scope('ability:*')\`.
export default {
  // SPA cookie auth — list domains allowed to authenticate via session cookies.
  stateful:    [],
  // Token expiration in minutes. \`null\` means tokens don't expire.
  expiration:  null,
  // Optional prefix added to generated tokens (helps secret-scanning tools).
  tokenPrefix: '',
} satisfies SanctumConfig
`
}
