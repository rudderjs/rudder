import type { OrmAdapterProvider, OrmAdapter } from '@forge/orm'

function notImplemented(): never {
  throw new Error(
    '[Forge] @forge/orm-drizzle is not yet implemented. ' +
    'Use @forge/orm-prisma instead.'
  )
}

export function drizzle(): OrmAdapterProvider {
  return {
    create(): OrmAdapter { notImplemented() },
  }
}