/**
 * Browser-side registry of client tool handlers.
 *
 * Server-side `Tool` definitions whose `execute` is omitted are "client tools".
 * The agent loop on the server stops as soon as the model calls one and yields
 * the call back over SSE; the chat context then runs the matching handler from
 * this registry and re-POSTs the result so the agent can continue.
 *
 * Components register handlers via `registerClientTool` (returning an
 * unregister function for cleanup) — typically in a `useEffect`.
 */

export type ClientToolHandler = (args: unknown) => Promise<unknown> | unknown

const handlers = new Map<string, ClientToolHandler>()

/**
 * Register a handler for a client tool. Returns an unregister function so it
 * can be cleaned up from `useEffect`.
 */
export function registerClientTool(name: string, handler: ClientToolHandler): () => void {
  handlers.set(name, handler)
  return () => {
    if (handlers.get(name) === handler) handlers.delete(name)
  }
}

/** Returns true if a client handler is registered for the given tool name. */
export function hasClientTool(name: string): boolean {
  return handlers.has(name)
}

/**
 * Execute the registered handler for a client tool. Throws if none is
 * registered — the agent loop interprets the rejection result as a tool error
 * and the model can recover.
 */
export async function executeClientTool(name: string, args: unknown): Promise<unknown> {
  const handler = handlers.get(name)
  if (!handler) {
    throw new Error(`No client handler registered for tool "${name}"`)
  }
  return await handler(args)
}
