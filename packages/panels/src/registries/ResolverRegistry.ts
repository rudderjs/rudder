/**
 * Registry for custom schema element resolvers.
 *
 * Plugins register async resolvers for their element types.
 * `resolveSchema` checks this registry before falling through to `toMeta()`.
 *
 * @example
 * ```ts
 * import { registerResolver } from '@boostkit/panels'
 *
 * registerResolver('media', async (el) => {
 *   const media = el as Media
 *   // ... load data from DB
 *   return media.toMeta()
 * })
 * ```
 */

type ResolverFn = (el: unknown, ctx: unknown) => Promise<unknown>

const resolvers = new Map<string, ResolverFn>()

export function registerResolver(type: string, resolver: ResolverFn): void {
  resolvers.set(type, resolver)
}

export function getResolver(type: string): ResolverFn | undefined {
  return resolvers.get(type)
}
