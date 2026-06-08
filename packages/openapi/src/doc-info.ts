import type { GenerateOptions } from './emitter.js'
import type { OpenApiConfig } from './types.js'

/**
 * Resolve the document `info` for the emitter: an explicit `override` wins,
 * then `config('openapi')`, then safe defaults. `config` comes from the optional
 * `@rudderjs/core` peer so this stays usable without a booted app (bare emitter).
 */
export async function resolveDocInfo(override?: Partial<GenerateOptions>): Promise<GenerateOptions> {
  let cfg: OpenApiConfig = {}
  try {
    const { config } = await import('@rudderjs/core')
    cfg = (config('openapi', {}) as OpenApiConfig) ?? {}
  } catch {
    // core not present / no config — defaults below.
  }

  const merged: GenerateOptions = {
    title:   override?.title   ?? cfg.title   ?? 'API',
    version: override?.version ?? cfg.version ?? '1.0.0',
  }
  const description = override?.description ?? cfg.description
  if (description !== undefined) merged.description = description
  const servers = override?.servers ?? cfg.servers
  if (servers !== undefined) merged.servers = servers
  if (override?.onWarn !== undefined) merged.onWarn = override.onWarn
  return merged
}
