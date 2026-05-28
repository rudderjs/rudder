import { ServiceProvider, config } from '@rudderjs/core'
import { SocialiteDriver, type SocialiteDriverConfig } from './driver.js'
import { GitHubProvider } from './drivers/github.js'
import { GoogleProvider } from './drivers/google.js'
import { FacebookProvider } from './drivers/facebook.js'
import { AppleProvider } from './drivers/apple.js'

// ─── Re-exports ───────────────────────────────────────────

export { SocialUser } from './social-user.js'
export { SocialiteDriver, InvalidStateException } from './driver.js'
export { GitHubProvider } from './drivers/github.js'
export { GoogleProvider } from './drivers/google.js'
export { FacebookProvider } from './drivers/facebook.js'
export { AppleProvider } from './drivers/apple.js'

export type { SocialiteDriverConfig, SocialiteCallbackRequest, SocialiteHttpErrorCause } from './driver.js'
export type { AppleSocialiteConfig } from './drivers/apple.js'

// ─── Built-in driver registry ─────────────────────────────

type DriverFactory = (config: SocialiteDriverConfig) => SocialiteDriver

const builtInDrivers: Record<string, DriverFactory> = {
  github:   (c) => new GitHubProvider(c),
  google:   (c) => new GoogleProvider(c),
  facebook: (c) => new FacebookProvider(c),
  apple:    (c) => new AppleProvider(c),
}

// ─── Socialite Facade ─────────────────────────────────────

export class Socialite {
  private static _config: SocialiteConfig = {}
  private static _custom = new Map<string, DriverFactory>()
  private static _instances = new Map<string, SocialiteDriver>()

  /** Get or create a driver instance by name. */
  static driver(name: string): SocialiteDriver {
    const existing = this._instances.get(name)
    if (existing) return existing

    const config = this._config[name]
    if (!config) throw new Error(`[RudderJS Socialite] Provider "${name}" is not configured.`)

    const factory = this._custom.get(name) ?? builtInDrivers[name]
    if (!factory) throw new Error(`[RudderJS Socialite] Unknown provider "${name}". Use Socialite.extend() to register custom drivers.`)

    const instance = factory(config)
    this._instances.set(name, instance)
    return instance
  }

  /** Register a custom OAuth driver. */
  static extend(name: string, factory: DriverFactory): void {
    this._custom.set(name, factory)
    // Drop any previously cached instance so the next driver(name) call uses
    // the new factory. Without this, calling extend() after driver() is silent
    // no-op and the old driver lingers (bites hot-reload + runtime override).
    this._instances.delete(name)
  }

  /** @internal — set config from the service provider. */
  static configure(config: SocialiteConfig): void {
    this._config = config
    this._instances.clear()
  }

  /** Test-cleanup hook (public — other packages reset across the boundary). */
  static reset(): void {
    this._config = {}
    this._custom.clear()
    this._instances.clear()
  }
}

// ─── Config ───────────────────────────────────────────────

export type SocialiteConfig = Record<string, SocialiteDriverConfig>

// ─── Service Provider ─────────────────────────────────────

/**
 * Service provider for OAuth via Socialite.
 *
 * Built-in drivers: github, google, facebook, apple
 *
 * Usage in bootstrap/providers.ts:
 *   import { SocialiteProvider } from '@rudderjs/socialite'
 *   export default [..., SocialiteProvider, ...]
 *
 * Reads its config from `config('socialite')` at boot time.
 */
export class SocialiteProvider extends ServiceProvider {
  register(): void {}

  async boot(): Promise<void> {
    const cfg = config<SocialiteConfig>('socialite')
    Socialite.configure(cfg)
    this.app.instance('socialite', Socialite)
  }
}
