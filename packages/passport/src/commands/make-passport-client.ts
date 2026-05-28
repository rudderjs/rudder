import type { MakeSpec } from '@rudderjs/console'

/**
 * `make:passport-client <Name>` — scaffold an OAuth client seeder.
 *
 * Lives at this subpath (rather than being registered inside
 * `PassportProvider.boot()`) because the CLI skips `bootApp()` for `make:*`
 * argv — so a spec only reachable through `boot()` is never wired into
 * Commander and the command silently prints top-level help. The CLI's
 * `loadPackageCommands()` imports this subpath directly. Same shape as
 * `@rudderjs/terminal`'s `make:terminal`.
 */
export const makePassportClientSpec: MakeSpec = {
  command:     'make:passport-client',
  description: 'Create a new OAuth client seeder',
  label:       'Passport client seeder created',
  directory:   'app/Seeders',
  stub: (className: string) => `import { createClient } from '@rudderjs/passport'

export async function ${className.replace(/Seeder$/, '').toLowerCase()}Clients(): Promise<void> {
  // Create a confidential client (server-side apps)
  const { client, secret } = await createClient({
    name: 'My Application',
    redirectUri: 'http://localhost:3000/callback',
    grantTypes: ['authorization_code', 'refresh_token'],
  })
  console.log('Client ID:', client.id)
  console.log('Secret:', secret)
}
`,
}
