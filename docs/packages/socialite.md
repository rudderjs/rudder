# Socialite

OAuth-based social authentication for RudderJS. Built-in providers for GitHub, Google, Facebook, and Apple, plus an extension point for custom OAuth providers. Use it to add "Sign in with ..." buttons to your app without hand-writing OAuth flows.

## Install

```bash
pnpm add @rudderjs/socialite
```

```ts
// config/services.ts
import { Env } from '@rudderjs/support'

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

The provider is auto-discovered. No external dependencies — every built-in provider uses native `fetch`.

## Routes

The OAuth dance is two routes per provider — one to start, one to receive the callback:

```ts
// routes/web.ts
import { Socialite } from '@rudderjs/socialite'

Route.get('/auth/github', () => Socialite.driver('github').redirect())

Route.get('/auth/github/callback', async (req) => {
  const user = await Socialite.driver('github').user(req)

  // Find or create your User by user.getEmail() / user.getId()
  const local = await User.firstOrCreate({ email: user.getEmail() }, {
    name:        user.getName() ?? user.getNickname(),
    avatar:      user.getAvatar(),
    githubId:    user.getId(),
  })

  await Auth.login(local)
  return Response.redirect('/')
})
```

`Socialite.driver(name).redirect()` returns a 302 `Response`. `Socialite.driver(name).user(req)` exchanges the authorization code for tokens and fetches the user profile.

## The user object

```ts
const user = await Socialite.driver('github').user(req)

user.getId()        // provider-specific unique ID
user.getName()      // full name (may be null)
user.getEmail()     // email (may be null — depends on provider + scopes)
user.getAvatar()    // avatar URL (may be null)
user.getNickname()  // username / handle (may be null)
user.token          // OAuth access token
user.refreshToken   // OAuth refresh token (may be null)
user.expiresIn      // seconds until expiry (may be null)
user.getRaw()       // raw provider response
```

For mobile apps or other flows where you already have an access token, `getUserByToken(token)` skips the code-exchange step:

```ts
const user = await Socialite.driver('github').getUserByToken(accessToken)
```

If you only need the tokens (no user fetch):

```ts
const { accessToken, refreshToken, expiresIn } =
  await Socialite.driver('github').getAccessToken(code)
```

## Scopes

Each provider has sensible defaults. Override per-call:

```ts
Socialite.driver('google').setScopes(['openid', 'email'])      // replace
Socialite.driver('github').withScopes(['repo', 'gist'])        // append
```

| Provider | Default scopes |
|---|---|
| `github` | `user:email` |
| `google` | `openid`, `profile`, `email` |
| `facebook` | `email` |
| `apple` | `name`, `email` |

## Sign-in-with-Apple

Apple's OAuth flow has two non-standard requirements the driver handles automatically — but you have to provide extra config.

`client_secret` must be a freshly-signed ES256 JWT (not a static string), so add three Apple-specific fields:

```ts
// config/socialite.ts
import { readFileSync } from 'node:fs'
import type { AppleSocialiteConfig } from '@rudderjs/socialite'

export default {
  apple: {
    clientId:    Env.get('APPLE_CLIENT_ID', ''),  // Service ID, e.g. com.example.app
    redirectUrl: Env.get('APPLE_REDIRECT_URL', ''),
    teamId:      Env.get('APPLE_TEAM_ID', ''),    // 10-char Team ID
    keyId:       Env.get('APPLE_KEY_ID', ''),     // 10-char Key ID for the .p8
    privateKey:  readFileSync(Env.get('APPLE_PRIVATE_KEY_PATH', ''), 'utf8'),
    clientSecret: '',                             // unused; left for type compat
  } satisfies AppleSocialiteConfig,
}
```

Download the `.p8` file once from the Apple Developer portal. The driver mints a fresh JWT per token exchange (5-minute lifetime by default; override with `clientSecretTtl`).

`id_token` returned from Apple is verified end-to-end before any user data is trusted: signature against Apple's JWKS (`https://appleid.apple.com/auth/keys`, cached for 1h), `iss === https://appleid.apple.com`, `aud` matches your `clientId`, `exp` in the future, and `sub` non-empty.

## State parameter

Pass a state string for CSRF protection — generate it before redirect, store it in the session, verify on callback:

```ts
const state = crypto.randomUUID()
await Session.put('oauth.state', state)

const url = Socialite.driver('github').getRedirectUrl(state)
return Response.redirect(url)
```

```ts
// callback
const expected = await Session.pull('oauth.state')
if (req.query.state !== expected) abort(400, 'State mismatch')
```

State isn't generated automatically — apps that need CSRF protection on the OAuth flow should follow this pattern.

## Custom providers

Extend `SocialiteProvider` to wire any OAuth 2.0 service:

```ts
import { Socialite, SocialiteProvider, SocialUser } from '@rudderjs/socialite'

class GitLabProvider extends SocialiteProvider {
  protected defaultScopes() { return ['read_user'] }
  protected authUrl()       { return 'https://gitlab.com/oauth/authorize' }
  protected tokenUrl()      { return 'https://gitlab.com/oauth/token' }
  protected userUrl()       { return 'https://gitlab.com/api/v4/user' }

  protected mapToUser(data, token, refreshToken) {
    return new SocialUser({
      id:       String(data.id),
      name:     data.name,
      email:    data.email,
      avatar:   data.avatar_url,
      nickname: data.username,
      token, refreshToken, raw: data,
    })
  }
}

Socialite.extend('gitlab', (config) => new GitLabProvider(config))
```

Add the matching config block to `config/services.ts` and you're done.

## Provider config shape

```ts
interface SocialiteProviderConfig {
  clientId:     string
  clientSecret: string
  redirectUrl:  string
  scopes?:      string[]
}
```

## Pitfalls

- **Email missing.** GitHub doesn't expose primary email when only `user:email` is granted *and* the user marks all emails as private. Handle the `null` case in your sign-up flow — fall back to nickname-based account creation, or prompt for email.
- **Apple's first-login quirk.** Apple sends `name` only on the first authorization. Persist it on first login; subsequent logins won't include it.
- **No state parameter.** Without CSRF state, an attacker can complete an OAuth flow and bind a victim's social identity to their own session. Always generate, store, and verify state.
- **Driver instance caching.** `Socialite.driver('github')` returns the same instance on repeat calls — `setScopes()` mutates that shared instance. For per-route customization, capture the instance per call site.
