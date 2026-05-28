import { ServiceProvider, config } from '@rudderjs/core'

// ─── Hash Driver Contract ─────────────────────────────────

export interface HashDriver {
  make(value: string): Promise<string>
  check(value: string, hashed: string): Promise<boolean>
  needsRehash(hashed: string): boolean
}

// ─── Hash Registry ────────────────────────────────────────

/**
 * Shared singleton store routed through `globalThis` so the registry survives
 * the case where `@rudderjs/hash` is loaded twice — typical in a Vite-bundled
 * server where the framework bundles `@rudderjs/hash` inline (`Hash.make` /
 * `Hash.check` read `HashRegistry`), but `HashProvider.boot()` runs from a
 * `node_modules` copy of `@rudderjs/hash` resolved via the provider
 * auto-discovery manifest. Without a shared store, `set()` from the
 * externalized copy would land on a different class than the one `Hash.*`
 * reads from inside the bundle, producing a misleading `No hash driver
 * registered` error on every password/credential hash call in prod — which
 * would break auth login/registration flows.
 *
 * Same pattern as PR #498 (`@rudderjs/orm` `ModelRegistry`), PR #500
 * (`@rudderjs/pennant`), PR #501 (`@rudderjs/cache`), PR #502
 * (`@rudderjs/queue`), PR #503 (`@rudderjs/mail`), and PR #504
 * (`@rudderjs/storage`).
 */
interface HashRegistryStore {
  driver: HashDriver | null
}

const _g = globalThis as Record<string, unknown>
if (!_g['__rudderjs_hash_registry__']) {
  _g['__rudderjs_hash_registry__'] = {
    driver: null,
  } satisfies HashRegistryStore
}
const _store = _g['__rudderjs_hash_registry__'] as HashRegistryStore

export class HashRegistry {
  static set(driver: HashDriver): void   { _store.driver = driver }
  static get(): HashDriver | null        { return _store.driver }
  /** Test-cleanup hook (public — other packages reset across the boundary). */
  static reset(): void                   { _store.driver = null }
}

// ─── Hash Facade ──────────────────────────────────────────

export class Hash {
  private static driver(): HashDriver {
    const d = HashRegistry.get()
    if (!d) throw new Error('[RudderJS Hash] No hash driver registered. Add hash() to providers.')
    return d
  }

  /** Hash a plain-text value. */
  static make(value: string): Promise<string> {
    return this.driver().make(value)
  }

  /** Check a plain-text value against a hash. */
  static check(value: string, hashed: string): Promise<boolean> {
    return this.driver().check(value, hashed)
  }

  /** Determine if a hash needs to be rehashed (e.g. cost changed). */
  static needsRehash(hashed: string): boolean {
    return this.driver().needsRehash(hashed)
  }
}

// ─── Bcrypt Driver (built-in) ─────────────────────────────

export interface BcryptConfig {
  rounds?: number
}

export class BcryptDriver implements HashDriver {
  private readonly rounds: number

  constructor(config?: BcryptConfig) {
    this.rounds = config?.rounds ?? 12
  }

  async make(value: string): Promise<string> {
    const bcrypt = (await import('bcryptjs')).default
    return bcrypt.hash(value, this.rounds)
  }

  async check(value: string, hashed: string): Promise<boolean> {
    const bcrypt = (await import('bcryptjs')).default
    return bcrypt.compare(value, hashed)
  }

  needsRehash(hashed: string): boolean {
    const match = hashed.match(/^\$2[aby]?\$(\d{2})\$/)
    if (!match) return true
    return parseInt(match[1]!, 10) !== this.rounds
  }
}

// ─── Argon2 Driver (optional, requires argon2) ───────────

export interface Argon2Config {
  memory?: number
  time?: number
  threads?: number
}

export class Argon2Driver implements HashDriver {
  private readonly memory: number
  private readonly time: number
  private readonly threads: number

  constructor(config?: Argon2Config) {
    this.memory  = config?.memory  ?? 65536
    this.time    = config?.time    ?? 3
    this.threads = config?.threads ?? 4
  }

  async make(value: string): Promise<string> {
    const argon2 = await import('argon2')
    return argon2.hash(value, {
      type:        2, // argon2id
      memoryCost:  this.memory,
      timeCost:    this.time,
      parallelism: this.threads,
    })
  }

  async check(value: string, hashed: string): Promise<boolean> {
    const argon2 = await import('argon2')
    return argon2.verify(hashed, value)
  }

  needsRehash(hashed: string): boolean {
    // Argon2 encodes params in the hash: $argon2id$v=19$m=65536,t=3,p=4$...
    const match = hashed.match(/\$m=(\d+),t=(\d+),p=(\d+)\$/)
    if (!match) return true
    return (
      parseInt(match[1]!, 10) !== this.memory  ||
      parseInt(match[2]!, 10) !== this.time    ||
      parseInt(match[3]!, 10) !== this.threads
    )
  }
}

// ─── Config ───────────────────────────────────────────────

export interface HashConfig {
  driver: 'bcrypt' | 'argon2'
  bcrypt?: BcryptConfig
  argon2?: Argon2Config
}

// ─── Service Provider Factory ─────────────────────────────

/**
 * Returns a HashServiceProvider class configured for the given hash config.
 *
 * Built-in drivers:  bcrypt  (default, uses bcryptjs)
 *                    argon2  (requires argon2: pnpm add argon2)
 *
 * Usage in bootstrap/providers.ts:
 *   import { hash } from '@rudderjs/hash'
 *   import configs from '../config/index.js'
 *   export default [..., hash(configs.hash), ...]
 */
export class HashProvider extends ServiceProvider {
  register(): void {}

  async boot(): Promise<void> {
    const cfg = config<HashConfig>('hash')

    let driver: HashDriver

    if (cfg.driver === 'bcrypt') {
      driver = new BcryptDriver(cfg.bcrypt)
    } else if (cfg.driver === 'argon2') {
      driver = new Argon2Driver(cfg.argon2)
    } else {
      throw new Error(`[RudderJS Hash] Unknown driver "${cfg.driver as string}". Available: bcrypt, argon2`)
    }

    HashRegistry.set(driver)
    this.app.instance('hash', driver)
  }
}
