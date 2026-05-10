import type { AiModelConfig, ProviderFactory, ProviderAdapter, RerankingAdapter, FileAdapter, VectorStoreAdapter } from './types.js'

/**
 * Try a list of provider/model strings in order until one succeeds.
 *
 * Used by the media-generation paths (Image, Audio, Transcription) to give
 * the same failover ergonomics agents already have. The first model is the
 * "primary"; the rest are fallbacks. Errors from earlier candidates are
 * swallowed; only the last error is thrown if every candidate fails.
 *
 * The agent loop has its own failover wired into LoopContext (telemetry,
 * abort handling, observer attempts counter). This is a simpler helper for
 * single-shot calls outside the agent loop.
 *
 * @param primary    The user's chosen model string (e.g. `'openai/dall-e-3'`).
 * @param fallbacks  Additional candidates to try on failure.
 * @param call       Receives each candidate model string and runs the work.
 */
export async function tryWithFailover<T>(
  primary: string,
  fallbacks: readonly string[],
  call: (modelString: string) => Promise<T>,
): Promise<T> {
  const candidates = fallbacks.length > 0
    ? [primary, ...fallbacks.filter((m) => m !== primary)]
    : [primary]
  let lastError: Error | undefined
  for (const m of candidates) {
    try {
      return await call(m)
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
    }
  }
  throw lastError ?? new Error('[RudderJS AI] No provider available for failover.')
}

export class AiRegistry {
  private static readonly factories = new Map<string, ProviderFactory>()
  private static _default: string | null = null
  private static _models: AiModelConfig[] = []

  /** Register a provider factory */
  static register(factory: ProviderFactory): void {
    this.factories.set(factory.name, factory)
  }

  /** Get a registered provider factory by name */
  static getFactory(name: string): ProviderFactory {
    const f = this.factories.get(name)
    if (!f) throw new Error(`[RudderJS AI] Unknown AI provider "${name}". Register it first.`)
    return f
  }

  /** Set the default provider/model string */
  static setDefault(modelString: string): void {
    this._default = modelString
  }

  /** Get the default provider/model string */
  static getDefault(): string {
    if (!this._default) throw new Error('[RudderJS AI] No default model set. Add ai() to providers with a config.')
    return this._default
  }

  /** Parse 'provider/model' string into [providerName, modelId] */
  static parseModelString(modelString: string): [string, string] {
    const slash = modelString.indexOf('/')
    if (slash === -1) throw new Error(`[RudderJS AI] Invalid model string "${modelString}". Expected "provider/model" format.`)
    return [modelString.slice(0, slash), modelString.slice(slash + 1)]
  }

  /** Resolve a provider/model string to a ProviderAdapter */
  static resolve(modelString: string): ProviderAdapter {
    const [providerName, model] = this.parseModelString(modelString)
    const factory = this.getFactory(providerName)
    return factory.create(model)
  }

  /** Resolve a provider/model string to a RerankingAdapter */
  static resolveReranking(modelString: string): RerankingAdapter {
    const [providerName, model] = this.parseModelString(modelString)
    const factory = this.getFactory(providerName)
    if (!factory.createReranking) {
      throw new Error(
        `[RudderJS AI] Provider "${providerName}" does not support reranking. ` +
        `Use a provider that implements createReranking() (e.g. cohere, jina).`,
      )
    }
    return factory.createReranking(model)
  }

  /** Resolve a file adapter for a provider name */
  static resolveFiles(providerName: string): FileAdapter {
    const factory = this.getFactory(providerName)
    if (!factory.createFiles) {
      throw new Error(
        `[RudderJS AI] Provider "${providerName}" does not support file management. ` +
        `Use a provider that implements createFiles() (e.g. openai, anthropic, google).`,
      )
    }
    return factory.createFiles()
  }

  /** Resolve a vector-store adapter for a provider name (#B8) */
  static resolveVectorStores(providerName: string): VectorStoreAdapter {
    const factory = this.getFactory(providerName)
    if (!factory.createVectorStores) {
      throw new Error(
        `[RudderJS AI] Provider "${providerName}" does not support hosted vector stores. ` +
        `Use a provider that implements createVectorStores() (e.g. openai). ` +
        `For self-hosted RAG, use similaritySearch() against an @rudderjs/orm Model with a pgvector column.`,
      )
    }
    return factory.createVectorStores()
  }

  /** Set available models for user selection */
  static setModels(models: AiModelConfig[]): void {
    this._models = models
  }

  /** Get available models */
  static getModels(): AiModelConfig[] {
    return this._models
  }

  /** @internal — reset for testing */
  static reset(): void {
    this.factories.clear()
    this._default = null
    this._models = []
  }
}
