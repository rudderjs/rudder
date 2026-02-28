import type { ServerAdapterProvider, ServerAdapter } from '@forge/server'

function notImplemented(pkg: string): never {
  throw new Error(
    `[Forge] @forge/server-h3 is not yet implemented. ` +
    `Install ${pkg} and swap the import in src/index.ts.`
  )
}

export function h3(): ServerAdapterProvider {
  return {
    type: 'h3',
    create(): ServerAdapter                          { notImplemented('@photonjs/h3') },
    createApp(): unknown                             { notImplemented('@photonjs/h3') },
    createFetchHandler(): Promise<never>             { notImplemented('@photonjs/h3') },
  }
}
