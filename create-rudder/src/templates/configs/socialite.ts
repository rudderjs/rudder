export function configSocialite(): string {
  return `import { Env } from '@rudderjs/core'
import type { SocialiteConfig } from '@rudderjs/socialite'

// Social login via @rudderjs/socialite. Built-in drivers: github, google,
// facebook, apple. Each driver needs a Client ID + Client Secret from the
// provider's developer console + a redirect URL registered there.
//
// Example flow controller:
//   import { Socialite } from '@rudderjs/socialite'
//   const driver = Socialite.driver('github')
//   return Response.redirect(await driver.redirect())
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
} satisfies SocialiteConfig
`
}
