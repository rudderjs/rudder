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

// bootstrap/providers.ts
import { socialite } from '@rudderjs/socialite'
export default [..., socialite(configs.socialite)]
```

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

## Providers

| Provider | Driver | Auth URL |
|----------|--------|----------|
| GitHub | `github` | `github.com/login/oauth/authorize` |
| Google | `google` | `accounts.google.com/o/oauth2/v2/auth` |
| Facebook | `facebook` | `facebook.com/v19.0/dialog/oauth` |
| Apple | `apple` | `appleid.apple.com/auth/authorize` |

## Custom Providers

```ts
import { SocialiteProvider, SocialUser, Socialite } from '@rudderjs/socialite'

class GitLabProvider extends SocialiteProvider {
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
