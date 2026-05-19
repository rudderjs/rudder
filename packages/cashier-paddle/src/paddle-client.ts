import { Cashier } from './Cashier.js'

// `@paddle/paddle-node-sdk` is an OPTIONAL peer dependency. Loaded lazily —
// pulling its types up front would force a hard dependency.
//
// Mirrors `@rudderjs/storage`'s S3 loader pattern: dynamic-import + actionable
// error if the SDK is missing.

interface PaddleClient {
  // Loose typing — we don't ship the SDK's types as part of our public API.
  subscriptions: Record<string, (...args: unknown[]) => Promise<unknown>>
  transactions:  Record<string, (...args: unknown[]) => Promise<unknown>>
  customers:     Record<string, (...args: unknown[]) => Promise<unknown>>
  prices:        Record<string, (...args: unknown[]) => Promise<unknown>>
  pricingPreview: Record<string, (...args: unknown[]) => Promise<unknown>>
}

let _client: PaddleClient | null = null
let _testClient: PaddleClient | null = null

export async function paddle(): Promise<PaddleClient> {
  if (_testClient) return _testClient
  if (_client) return _client

  const apiKey = Cashier.apiKey()
  if (!apiKey) {
    throw new Error(
      '[RudderJS Cashier] PADDLE_API_KEY not configured. Set it in `config/cashier.ts` or via the `PADDLE_API_KEY` env var.',
    )
  }

  let mod: { Paddle?: new (key: string, opts?: Record<string, unknown>) => PaddleClient; Environment?: { sandbox: string; production: string } }
  try {
    mod = await import('@paddle/paddle-node-sdk') as unknown as typeof mod
  } catch {
    throw new Error(
      '[RudderJS Cashier] `@paddle/paddle-node-sdk` is not installed. Run:\n' +
      '  pnpm add @paddle/paddle-node-sdk',
    )
  }

  if (!mod.Paddle) {
    throw new Error('[RudderJS Cashier] `@paddle/paddle-node-sdk` did not export `Paddle`. Check the SDK version.')
  }

  const environment = Cashier.sandbox() ? mod.Environment?.sandbox : mod.Environment?.production
  _client = new mod.Paddle(apiKey, environment ? { environment } : {})
  return _client
}

/** @internal — drop the cached client (used by tests). */
export function resetPaddleClient(): void {
  _client = null
  _testClient = null
}

/**
 * @internal — inject a stand-in client used by tests. Pass `null` to clear.
 * Takes precedence over the cached SDK client; the same `paddle()` callers
 * see the injected value without further plumbing.
 */
export function setPaddleClientForTesting(client: unknown): void {
  _testClient = client as PaddleClient | null
}
