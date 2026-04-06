# @rudderjs/socialite

OAuth authentication with built-in providers for GitHub, Google, Facebook, and Apple. Extensible with custom providers.

## Installation

```bash
pnpm add @rudderjs/socialite
```

## Setup

### 1. Add services config

```ts
// config/services.ts
import { Env } from '@rudderjs/core'

export default {
  github: {
    clientId:     Env.get('GITHUB_CLIENT_ID', ''),
    clientSecret: Env.get('GITHUB_CLIENT_SECRET', ''),
    redirectUrl:  Env.get('GITHUB_REDIRECT_URL', 'http://localhost:3000/auth/github/callback'),
  },
  google: {
    clientId:     Env.get('GOOGLE_CLIENT_ID', ''),
    clientSecret: Env.get('GOOGLE_CLIENT_SECRET', ''),
    redirectUrl:  Env.get('GOOGLE_REDIRECT_URL', 'http://localhost:3000/auth/google/callback'),
    scopes:       ['openid', 'profile', 'email'],
  },
}
```

### 2. Register provider

```ts
// bootstrap/providers.ts
import { socialite } from '@rudderjs/socialite'
import configs from '../config/index.js'

export default [
  // ...other providers
  socialite(configs.services),
]
```

## Socialite Facade

### `Socialite.driver(name)`

Get or create a provider instance by name. Returns a `SocialiteProvider` with the following methods:

```ts
import { Socialite } from '@rudderjs/socialite'

// Redirect to OAuth provider (returns a 302 Response)
const response = Socialite.driver('github').redirect()

// Get redirect URL without redirecting
const url = Socialite.driver('github').getRedirectUrl()

// Pass optional state parameter
const url = Socialite.driver('github').getRedirectUrl('random-state-string')
```

### `provider.user(code)`

Exchange the authorization code for an access token and fetch the authenticated user:

```ts
// routes/api.ts
router.get('/auth/github/callback', async (req) => {
  const code = req.query.code
  const user = await Socialite.driver('github').user(code)

  // user.getId()       — provider-specific unique ID
  // user.getName()     — full name (nullable)
  // user.getEmail()    — email address (nullable)
  // user.getAvatar()   — avatar URL (nullable)
  // user.getNickname() — username/handle (nullable)
  // user.token         — access token
  // user.refreshToken  — refresh token (nullable)
  // user.getRaw()      — raw API response
})
```

You can also pass a request object with a `query` property:

```ts
const user = await Socialite.driver('github').user(req)
```

### `provider.getUserByToken(token)`

Fetch the user directly from an access token (useful for mobile apps or token-based flows):

```ts
const user = await Socialite.driver('github').getUserByToken(accessToken)
```

### `provider.getAccessToken(code)`

Exchange the authorization code for tokens without fetching the user:

```ts
const { accessToken, refreshToken, expiresIn } = await Socialite.driver('github').getAccessToken(code)
```

## SocialUser Methods

| Method | Returns | Description |
|---|---|---|
| `getId()` | `string` | Provider-specific unique user ID |
| `getName()` | `string \| null` | Full name |
| `getEmail()` | `string \| null` | Email address |
| `getAvatar()` | `string \| null` | Avatar URL |
| `getNickname()` | `string \| null` | Username or handle |
| `.token` | `string` | OAuth access token |
| `.refreshToken` | `string \| null` | OAuth refresh token |
| `.expiresIn` | `number \| null` | Token expiry in seconds |
| `getRaw()` | `Record<string, unknown>` | Raw provider API response |

## Scopes

Each provider defines sensible default scopes. Override or extend them:

```ts
// Replace all scopes
Socialite.driver('google').setScopes(['openid', 'email'])

// Add to existing scopes
Socialite.driver('github').withScopes(['repo', 'gist'])
```

## Custom Providers

Register a custom OAuth provider with `Socialite.extend()`:

```ts
import { Socialite, SocialiteProvider, SocialUser } from '@rudderjs/socialite'
import type { SocialiteProviderConfig } from '@rudderjs/socialite'

class GitLabProvider extends SocialiteProvider {
  protected defaultScopes(): string[] { return ['read_user'] }
  protected authUrl():  string { return 'https://gitlab.com/oauth/authorize' }
  protected tokenUrl(): string { return 'https://gitlab.com/oauth/token' }
  protected userUrl():  string { return 'https://gitlab.com/api/v4/user' }

  protected mapToUser(data: Record<string, unknown>, token: string, refreshToken: string | null): SocialUser {
    return new SocialUser({
      id:       String(data['id']),
      name:     data['name'] as string,
      email:    data['email'] as string,
      avatar:   data['avatar_url'] as string,
      nickname: data['username'] as string,
      token,
      refreshToken,
      raw: data,
    })
  }
}

Socialite.extend('gitlab', (config) => new GitLabProvider(config))
```

Then configure it in `config/services.ts`:

```ts
export default {
  gitlab: {
    clientId:     Env.get('GITLAB_CLIENT_ID', ''),
    clientSecret: Env.get('GITLAB_CLIENT_SECRET', ''),
    redirectUrl:  'http://localhost:3000/auth/gitlab/callback',
  },
}
```

## Configuration

```ts
interface SocialiteProviderConfig {
  clientId:     string
  clientSecret: string
  redirectUrl:  string
  scopes?:      string[]
}

// Top-level config is a record of provider name → config
type SocialiteConfig = Record<string, SocialiteProviderConfig>
```

## Built-in Providers

| Provider | Auth URL | Default Scopes |
|---|---|---|
| `github` | `github.com/login/oauth/authorize` | `user:email` |
| `google` | `accounts.google.com/o/oauth2/v2/auth` | `openid`, `profile`, `email` |
| `facebook` | `facebook.com/v18.0/dialog/oauth` | `email` |
| `apple` | `appleid.apple.com/auth/authorize` | `name`, `email` |

## Notes

- All providers use the standard OAuth 2.0 authorization code flow.
- `redirect()` returns a standard `Response` object with a 302 redirect.
- The `state` parameter is optional but recommended for CSRF protection.
- Provider instances are cached per name — calling `Socialite.driver('github')` twice returns the same instance.
- No external dependencies required.
