import type { AiMiddleware } from '@rudderjs/ai'

/**
 * Broadcast middleware — streams all chunks to a WebSocket channel.
 *
 * Uses `@rudderjs/broadcast` (dynamically imported to avoid hard dependency).
 * Clients subscribe to the channel to receive real-time stream chunks.
 *
 * @example
 * const orchestrator = new Orchestrator({
 *   ...options,
 *   middleware: [broadcastMiddleware(`private-workspace.${workspaceId}`)],
 * })
 */
export function broadcastMiddleware(channel: string): AiMiddleware {
  return {
    name: 'broadcast',

    onChunk(ctx, chunk) {
      import('@rudderjs/broadcast').then(({ broadcast }) => {
        broadcast(channel, 'stream:chunk', chunk)
      }).catch(() => {})
      return chunk
    },

    async onFinish(ctx) {
      import('@rudderjs/broadcast').then(({ broadcast }) => {
        broadcast(channel, 'stream:finish', { requestId: ctx.requestId })
      }).catch(() => {})
    },

    async onError(ctx, error) {
      import('@rudderjs/broadcast').then(({ broadcast }) => {
        broadcast(channel, 'stream:error', {
          requestId: ctx.requestId,
          error: error instanceof Error ? error.message : String(error),
        })
      }).catch(() => {})
    },
  }
}
