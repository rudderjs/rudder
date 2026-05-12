# @rudderjs/socialite

OAuth authentication for RudderJS. Built-in providers: GitHub, Google, Facebook, Apple. Extensible with custom providers.

## Installation

```bash
pnpm add @rudderjs/socialite
```

## Setup

```ts
// config/socialite.ts
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
  },
}

```

`SocialiteProvider` is picked up by [auto-discovery](https://github.com/rudderjs/rudder/blob/main/docs/guide/service-providers.md#auto-discovery) — `pnpm rudder providers:discover` is all that's needed.

## Usage

```ts
import { Socialite } from '@rudderjs/socialite'
import { Auth } from '@rudderjs/auth'

// Redirect to provider
Route.get('/auth/github', () => {
  return Socialite.driver('github').redirect()
})

// Handle callback
Route.get('/auth/github/callback', async (req) => {
  const socialUser = await Socialite.driver('github').user(req)

  socialUser.getId()       // "12345"
  socialUser.getName()     // "John Doe"
  socialUser.getEmail()    // "john@example.com"
  socialUser.getAvatar()   // "https://..."
  socialUser.getNickname() // "johnd"
  socialUser.token         // "gho_abc123..."

  // Find or create local user, then login
  const user = await User.firstOrCreate(
    { githubId: socialUser.getId() },
    { name: socialUser.getName(), email: socialUser.getEmail() },
  )
  await Auth.login(user)
  return Response.redirect('/')
})
```

## CSRF state — stateful by default

Socialite mints a CSPRNG `state` parameter on every redirect, persists it
on the session, and validates the `state` returned in the callback before
exchanging the code. A mismatch (or a missing session) throws
`InvalidStateException` — same defense Laravel Socialite ships out of the
box. No code changes needed: the routes above are already protected, as
long as `@rudderjs/session`'s middleware is mounted (auto-installed on
the `web` group).

For flows that legitimately can't reach the session — mobile clients,
machine-to-machine token grants, server-side OAuth where the round-trip
happens entirely off-browser — opt out per call:

```ts
Route.get('/auth/github', () => {
  return Socialite.driver('github').stateless().redirect()
})

Route.get('/auth/github/callback', async (req) => {
  const user = await Socialite.driver('github').stateless().user(req)
  // …
})
```

`InvalidStateException` is exported for `instanceof`-checks in your
exception handler:

```ts
import { InvalidStateException } from '@rudderjs/socialite'

try {
  await Socialite.driver('github').user(req)
} catch (err) {
  if (err instanceof InvalidStateException) return abort(403, 'Auth failed.')
  throw err
}
```

State is namespaced per provider (`socialite_state:github`,
`socialite_state:google`, …) so concurrent OAuth flows on the same
session don't collide. State is one-time use — successful or failed
validation clears the slot, so a leaked value can't be replayed.

## Providers

| Provider | Driver | Auth URL |
|----------|--------|----------|
| GitHub | `github` | `github.com/login/oauth/authorize` |
| Google | `google` | `accounts.google.com/o/oauth2/v2/auth` |
| Facebook | `facebook` | `facebook.com/v19.0/dialog/oauth` |
| Apple | `apple` | `appleid.apple.com/auth/authorize` |

### Sign-in-with-Apple — extra config

Apple's OAuth flow requires a freshly-signed ES256 JWT as `client_secret`
on every token exchange (a raw string is rejected with `invalid_client`).
Add three Apple-specific fields to your config:

```ts
// config/socialite.ts
import { readFileSync } from 'node:fs'
import type { AppleSocialiteConfig } from '@rudderjs/socialite'

export default {
  apple: {
    clientId:    Env.get('APPLE_CLIENT_ID', ''),     // Service ID, e.g. com.example.app
    redirectUrl: Env.get('APPLE_REDIRECT_URL', ''),
    teamId:      Env.get('APPLE_TEAM_ID', ''),       // 10-char Team ID from developer.apple.com
    keyId:       Env.get('APPLE_KEY_ID', ''),        // 10-char Key ID for the .p8
    privateKey:  readFileSync(Env.get('APPLE_PRIVATE_KEY_PATH', ''), 'utf8'),
    clientSecret: '',                                // unused; left for type compat
  } satisfies AppleSocialiteConfig,
}
```

Download the `.p8` file once from the Apple Developer portal and either
read it from disk (as above) or pass its PEM contents directly. The
driver verifies returned `id_token`s against Apple's JWKS
(`https://appleid.apple.com/auth/keys`, cached for 1h) — signature, `iss`,
`aud`, and `exp` are all checked before any user data is trusted.

Apple's first-authorization callback POSTs the user's `name` once in the
form-post body. RudderJS reads it automatically when you pass the request
object to `user(req)`. Your route handler must include the `body` in the
request shape — `@rudderjs/server-hono` already does this.

## Custom Providers

```ts
import { SocialiteDriver, SocialUser, Socialite } from '@rudderjs/socialite'

class GitLabProvider extends SocialiteDriver {
  protected defaultScopes() { return ['read_user'] }
  protected authUrl()  { return 'https://gitlab.com/oauth/authorize' }
  protected tokenUrl() { return 'https://gitlab.com/oauth/token' }
  protected userUrl()  { return 'https://gitlab.com/api/v4/user' }

  protected mapToUser(data: Record<string, unknown>, token: string, refreshToken: string | null) {
    return new SocialUser({
      id: String(data['id']), name: data['name'] as string,
      email: data['email'] as string, avatar: data['avatar_url'] as string,
      nickname: data['username'] as string, token, refreshToken, raw: data,
    })
  }
}

Socialite.extend('gitlab', (config) => new GitLabProvider(config))
```

## Scopes

```ts
// Add scopes
Socialite.driver('github').withScopes(['repo'])

// Replace scopes entirely
Socialite.driver('github').setScopes(['read:user'])
```
