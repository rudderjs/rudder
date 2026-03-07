import { config as _config } from '@boostkit/support'

// ─── AppConfig ─────────────────────────────────────────────

/**
 * Augment this interface in your project to get fully typed config() calls.
 *
 * @example
 * // config/index.ts
 * import type configs from './index.js'
 * declare module '@boostkit/core' {
 *   interface AppConfig extends typeof configs {}
 * }
 */
export interface AppConfig {}

// ─── Path utilities ────────────────────────────────────────

type IsEmpty<T> = keyof T extends never ? true : false

type Paths<T> = T extends Record<string, unknown>
  ? {
      [K in keyof T & string]:
        T[K] extends Record<string, unknown>
          ? K | `${K}.${Paths<T[K]>}`
          : K
    }[keyof T & string]
  : never

type Get<T, P extends string> =
  P extends `${infer K}.${infer Rest}`
    ? K extends keyof T ? Get<T[K], Rest> : unknown
    : P extends keyof T ? T[P] : unknown

// When AppConfig is empty (not augmented), fall back to string/unknown
// so config() remains callable without augmentation.
type ConfigKey   = IsEmpty<AppConfig> extends true ? string   : Paths<AppConfig>
type ConfigValue<K extends string> = IsEmpty<AppConfig> extends true ? unknown : Get<AppConfig, K>

// ─── Typed config() ────────────────────────────────────────

export function config<K extends ConfigKey>(key: K, fallback?: ConfigValue<K>): ConfigValue<K>
export function config<T = unknown>(key: string, fallback?: T): T
export function config(key: string, fallback?: unknown): unknown {
  return _config(key, fallback)
}
