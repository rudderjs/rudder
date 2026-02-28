import type { ServerAdapterProvider, ServerAdapter } from '@forge/server'

function notImplemented(): never {
  throw new Error(
    '[Forge] @forge/server-express is not yet implemented. ' +
    'Use @forge/server-hono or @forge/server-h3 instead.'
  )
}

export function express(): ServerAdapterProvider {
  return {
    type: 'express',
    create(): ServerAdapter                          { notImplemented() },
    createApp(): unknown                             { notImplemented() },
    createFetchHandler(): Promise<never>             { notImplemented() },
  }
}
