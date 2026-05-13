import type { McpToolResult, McpToolReturn, McpToolProgress } from '../McpTool.js'

/** SDK request handler `extra` shape — minimal; we only use sendNotification. */
export type SdkRequestExtra = {
  sendNotification?: (notification: { method: string; params: Record<string, unknown> }) => Promise<void> | void
}

/**
 * Run a tool's `handle()` return value to completion.
 *
 * - Plain `Promise<McpToolResult>` → just await it.
 * - `AsyncGenerator<McpToolProgress, McpToolResult>` → iterate, forwarding each
 *   yield as a `notifications/progress` message to the client (only when the
 *   request supplied a `progressToken` in `_meta`), and resolve to the final
 *   value the generator returns.
 *
 * Errors propagate normally so the outer try/catch handles them.
 */
export async function consumeToolReturn(
  ret: McpToolReturn,
  extra: SdkRequestExtra | undefined,
  meta: Record<string, unknown> | undefined,
): Promise<McpToolResult> {
  // Detect an async generator. Plain Promises don't have Symbol.asyncIterator.
  const maybeIter = ret as unknown as { [Symbol.asyncIterator]?: unknown; next?: unknown }
  const isGenerator = maybeIter
    && typeof maybeIter.next === 'function'
    && typeof maybeIter[Symbol.asyncIterator] === 'function'

  if (!isGenerator) return await (ret as Promise<McpToolResult>)

  const iter = ret as AsyncGenerator<McpToolProgress, McpToolResult, unknown>
  const progressToken = meta?.['progressToken']
  const sendNotification = extra?.sendNotification

  while (true) {
    const next = await iter.next()
    if (next.done) return next.value
    if (progressToken !== undefined && sendNotification) {
      await sendNotification({
        method: 'notifications/progress',
        params: { progressToken, ...next.value },
      })
    }
  }
}
