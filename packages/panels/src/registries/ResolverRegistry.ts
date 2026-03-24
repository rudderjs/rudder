import { createMapRegistry } from './BaseRegistry.js'

type ResolverFn = (el: unknown, ctx: unknown) => Promise<unknown>

const resolvers = createMapRegistry<ResolverFn>('resolvers')

/** Register an async SSR resolver for a custom schema element type. */
export const registerResolver = resolvers.register
/** Look up a registered resolver by type. @internal */
export const getResolver      = resolvers.get
