# @rudderjs/socialite

## Overview

OAuth authentication for third-party sign-in — GitHub, Google, Facebook, Apple out of the box, plus a driver contract for custom providers. Laravel's Socialite for Node. Handles the redirect → callback → exchange → user-fetch flow; you wire the routes. Pairs with `@rudderjs/auth` — after exchange, you call `Auth.login(user)` with a local user you've linked to the social profile.

## Key Patterns

### Setup

```ts
// config/socialite.ts
export default {
  github: {
    clientId:     process.env.GITHUB_CLIENT_ID!,
    clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    redirectUrl:  'http://localhost:3000/auth/github/callback',
  },
  google: { clientId: '...', clientSecret: '...', redirectUrl: '...' },
}

// bootstrap/providers.ts
import { SocialiteProvider } from '@rudderjs/socialite'
export default [SocialiteProvider]
```

### OAuth flow

```ts
import { Socialite } from '@rudderjs/socialite'
import { Auth } from '@rudderjs/auth'

// 1. Redirect to provider
Route.get('/auth/github', () => {
  return Socialite.driver('github').redirect()
})

// 2. Handle callback → exchange code → fetch profile → log in
Route.get('/auth/github/callback', async (req) => {
  const socialUser = await Socialite.driver('github').user(req)

  // socialUser methods: getId(), getName(), getEmail(), getAvatar(), getNickname(), getRaw()
  // socialUser getters: .token, .refreshToken, .expiresIn
  const id          = socialUser.getId()
  const email       = socialUser.getEmail()
  const accessToken = socialUser.token

  // Find or create a local user
  let user = await User.where('email', email).first()
  if (!user) {
    user = await User.create({ email, name: socialUser.getName() })
  }

  // Log in via @rudderjs/auth
  await Auth.login(user)
  return redirect('/dashboard')
})
```

### Scopes + state

```ts
// Replace defaults
Socialite.driver('github').setScopes(['user:email', 'read:org']).redirect()

// Or extend defaults — withScopes() merges, deduped
Socialite.driver('github').withScopes(['read:org']).redirect()

// Skip CSRF state (mobile / machine-to-machine flows that can't reach the session)
Socialite.driver('github').stateless().redirect()
```

State (CSRF) is handled automatically — stored in the session and verified on callback. To inject extra provider-specific query parameters (`prompt=consent`, Apple's `response_mode=form_post`, etc.), override `extraAuthParams()` on a custom driver subclass — there is no fluent `.with({...})` method.

### Custom providers

`SocialiteDriver` declares `authUrl`, `tokenUrl`, `userUrl`, `defaultScopes`, and `mapToUser` as abstract **methods** (not properties). Override each:

```ts
import { Socialite, SocialiteDriver, SocialUser } from '@rudderjs/socialite'

class DiscordDriver extends SocialiteDriver {
  protected defaultScopes() { return ['identify', 'email'] }
  protected authUrl()  { return 'https://discord.com/api/oauth2/authorize' }
  protected tokenUrl() { return 'https://discord.com/api/oauth2/token' }
  protected userUrl()  { return 'https://discord.com/api/users/@me' }

  protected mapToUser(raw: Record<string, unknown>, token: string, refreshToken: string | null): SocialUser {
    return new SocialUser({
      id:       String(raw['id']),
      name:     (raw['username'] as string) ?? null,
      email:    (raw['email']    as string) ?? null,
      avatar:   raw['avatar'] ? `https://cdn.discordapp.com/avatars/${raw['id']}/${raw['avatar']}.png` : null,
      nickname: null,
      token,
      refreshToken,
      raw,
    })
  }
}

Socialite.extend('discord', (cfg) => new DiscordDriver(cfg))
```

### SocialUser interface

```ts
// Methods
socialUser.getId()         // provider's user id (always string)
socialUser.getName()       // string | null
socialUser.getEmail()      // string | null
socialUser.getAvatar()     // string | null
socialUser.getNickname()   // string | null
socialUser.getRaw()        // Record<string, unknown> — full raw provider response

// Getters (not methods)
socialUser.token           // access token
socialUser.refreshToken    // string | null
socialUser.expiresIn       // number | null
```

## Common Pitfalls

- **Missing `redirectUrl` registration with the provider.** Each provider requires the callback URL to be pre-registered in its developer console. Mismatched URLs (e.g. `http` vs `https`, trailing slash) cause silent redirect failures.
- **State mismatch on callback.** State is stored in the session — if the callback request doesn't carry the same session cookie (cross-domain, SameSite=strict, third-party cookie blocking), state validation fails. Make sure `SameSite=lax` (the default) for the auth callback routes.
- **Skipping `Auth.login()` after exchange.** `Socialite.user(req)` returns the social profile but does NOT log anyone in. You must find/create a local user and call `Auth.login(user)` yourself.
- **Handling "email not verified" or "email missing".** Some providers (GitHub with private email, Apple always) don't return email on first auth. Prompt the user for email after the social flow if the social email is empty.
- **Account linking.** If `user@example.com` signs up via email then later via Google, you need your own logic to link them. Socialite doesn't do this — find-by-email in the callback handler is the usual pattern.
- **Testing.** Use fixture responses + HTTP fake. Don't hit real OAuth endpoints in tests.

## Key Imports

```ts
import { SocialiteProvider, Socialite, SocialiteDriver } from '@rudderjs/socialite'

import type { SocialiteConfig, SocialUser } from '@rudderjs/socialite'
```
