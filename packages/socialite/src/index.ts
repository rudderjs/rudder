import { ServiceProvider, type Application } from '@rudderjs/core'
import { SocialiteProvider, type SocialiteProviderConfig } from './provider.js'
import { GitHubProvider } from './drivers/github.js'
import { GoogleProvider } from './drivers/google.js'
import { FacebookProvider } from './drivers/facebook.js'
import { AppleProvider } from './drivers/apple.js'

// ─── Re-exports ───────────────────────────────────────────

export { SocialUser } from './social-user.js'
export { SocialiteProvider } from './provider.js'
export { GitHubProvider } from './drivers/github.js'
export { GoogleProvider } from './drivers/google.js'
export { FacebookProvider } from './drivers/facebook.js'
export { AppleProvider } from './drivers/apple.js'

export type { SocialiteProviderConfig } from './provider.js'

// ─── Built-in driver registry ─────────────────────────────

type ProviderFactory = (config: SocialiteProviderConfig) => SocialiteProvider

const builtInDrivers: Record<string, ProviderFactory> = {
  github:   (c) => new GitHubProvider(c),
  google:   (c) => new GoogleProvider(c),
  facebook: (c) => new FacebookProvider(c),
  apple:    (c) => new AppleProvider(c),
}

// ─── Socialite Facade ─────────────────────────────────────

export class Socialite {
  private static _config: SocialiteConfig = {}
  private static _custom = new Map<string, ProviderFactory>()
  private static _instances = new Map<string, SocialiteProvider>()

  /** Get or create a provider instance by name. */
  static driver(name: string): SocialiteProvider {
    const existing = this._instances.get(name)
    if (existing) return existing

    const config = this._config[name]
    if (!config) throw new Error(`[RudderJS Socialite] Provider "${name}" is not configured.`)

    const factory = this._custom.get(name) ?? builtInDrivers[name]
    if (!factory) throw new Error(`[RudderJS Socialite] Unknown provider "${name}". Use Socialite.extend() to register custom providers.`)

    const instance = factory(config)
    this._instances.set(name, instance)
    return instance
  }

  /** Register a custom provider driver. */
  static extend(name: string, factory: ProviderFactory): void {
    this._custom.set(name, factory)
  }

  /** @internal — set config from the service provider. */
  static configure(config: SocialiteConfig): void {
    this._config = config
    this._instances.clear()
  }

  /** @internal — reset for testing. */
  static reset(): void {
    this._config = {}
    this._custom.clear()
    this._instances.clear()
  }
}

// ─── Config ───────────────────────────────────────────────

export type SocialiteConfig = Record<string, SocialiteProviderConfig>

// ─── Service Provider Factory ─────────────────────────────

/**
 * Returns a SocialiteServiceProvider configured for OAuth.
 *
 * Built-in providers: github, google, facebook, apple
 *
 * Usage in bootstrap/providers.ts:
 *   import { socialite } from '@rudderjs/socialite'
 *   export default [..., socialite(configs.socialite), ...]
 */
export function socialite(config: SocialiteConfig): new (app: Application) => ServiceProvider {
  class SocialiteServiceProvider extends ServiceProvider {
    register(): void {}

    async boot(): Promise<void> {
      Socialite.configure(config)
      this.app.instance('socialite', Socialite)
    }
  }

  return SocialiteServiceProvider
}
