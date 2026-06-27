import { ServiceProvider, config, bootNotice } from '@rudderjs/core'
import {
  AiRegistry,
  setConversationStore,
  setUserMemory,
  configureAiQueue,
  GoogleCacheRegistry,
  AnthropicProvider,
  OpenAIProvider,
  GoogleProvider,
  OllamaProvider,
  DeepSeekProvider,
  XaiProvider,
  GroqProvider,
  MistralProvider,
  AzureOpenAIProvider,
  OpenRouterProvider,
  BedrockProvider,
  ElevenLabsProvider,
  VoyageProvider,
  type CacheStoreLike,
  type AiConfig,
  type AiProviderConfig,
  type ProviderFactory,
} from '@gemstack/ai-sdk'

/**
 * Return the configured `apiKey`, or `null` when missing/empty.
 *
 * The config type lets `apiKey` be undefined (some drivers — ollama, bedrock —
 * don't need one), so apiKey-requiring drivers use this gate. When the gate
 * returns `null` the driver factory bails to `null` and `AiProvider.boot()`
 * skips the provider with a warning instead of crashing — matches Laravel's
 * "drivers as data, missing credentials don't kill the framework" pattern.
 *
 * Use-site (`AI.use('anthropic')`) will surface the standard
 * "provider not registered" error so debugging stays actionable.
 */
function requireKey(_name: string, cfg: AiProviderConfig): string | null {
  return cfg.apiKey || null
}

type DriverDeps = { googleCacheRegistry: GoogleCacheRegistry }
type DriverBuilder = (name: string, cfg: AiProviderConfig, deps: DriverDeps) => ProviderFactory | null

const DRIVERS: Record<string, DriverBuilder> = {
  anthropic: (name, cfg) => {
    const apiKey = requireKey(name, cfg); if (apiKey === null) return null
    return new AnthropicProvider({ apiKey, baseUrl: cfg.baseUrl })
  },
  openai: (name, cfg) => {
    const apiKey = requireKey(name, cfg); if (apiKey === null) return null
    return new OpenAIProvider({
      apiKey,
      baseUrl:      cfg.baseUrl,
      organization: cfg['organization'] as string | undefined,
    })
  },
  google: (name, cfg, { googleCacheRegistry }) => {
    const apiKey = requireKey(name, cfg); if (apiKey === null) return null
    return new GoogleProvider({ apiKey }, googleCacheRegistry)
  },
  ollama: (_name, cfg) => {
    return new OllamaProvider({ baseUrl: cfg.baseUrl })
  },
  deepseek: (name, cfg) => {
    const apiKey = requireKey(name, cfg); if (apiKey === null) return null
    return new DeepSeekProvider({ apiKey, baseUrl: cfg.baseUrl })
  },
  xai: (name, cfg) => {
    const apiKey = requireKey(name, cfg); if (apiKey === null) return null
    return new XaiProvider({ apiKey, baseUrl: cfg.baseUrl })
  },
  groq: (name, cfg) => {
    const apiKey = requireKey(name, cfg); if (apiKey === null) return null
    return new GroqProvider({ apiKey, baseUrl: cfg.baseUrl })
  },
  mistral: (name, cfg) => {
    const apiKey = requireKey(name, cfg); if (apiKey === null) return null
    return new MistralProvider({ apiKey, baseUrl: cfg.baseUrl })
  },
  azure: (name, cfg) => {
    const apiKey = requireKey(name, cfg); if (apiKey === null) return null
    if (!cfg.baseUrl) {
      throw new Error(`[ai-sdk] config('ai').providers.${name} is missing baseUrl (driver "azure" requires it).`)
    }
    return new AzureOpenAIProvider({ apiKey, baseUrl: cfg.baseUrl })
  },
  openrouter: (name, cfg) => {
    const apiKey = requireKey(name, cfg); if (apiKey === null) return null
    return new OpenRouterProvider({
      apiKey,
      baseUrl:  cfg.baseUrl,
      siteUrl:  cfg['siteUrl'] as string | undefined,
      siteName: cfg['siteName'] as string | undefined,
    })
  },
  bedrock: (_name, cfg) => {
    const region = (cfg['region'] as string | undefined) ?? 'us-east-1'
    const credentials = cfg['credentials'] as
      | { accessKeyId: string; secretAccessKey: string; sessionToken?: string }
      | undefined
    return new BedrockProvider(credentials ? { region, credentials } : { region })
  },
  elevenlabs: (name, cfg) => {
    const apiKey = requireKey(name, cfg); if (apiKey === null) return null
    return new ElevenLabsProvider({
      apiKey,
      ...(cfg.baseUrl              ? { baseUrl:           cfg.baseUrl                              } : {}),
      ...(cfg['defaultTtsModelId'] ? { defaultTtsModelId: cfg['defaultTtsModelId'] as string       } : {}),
    })
  },
  voyage: (name, cfg) => {
    const apiKey = requireKey(name, cfg); if (apiKey === null) return null
    return new VoyageProvider({
      apiKey,
      ...(cfg.baseUrl             ? { baseUrl:          cfg.baseUrl                                            } : {}),
      ...(cfg['defaultInputType'] ? { defaultInputType: cfg['defaultInputType'] as 'query' | 'document'        } : {}),
    })
  },
}

/**
 * AI ServiceProvider — reads config from `config('ai')`.
 *
 * @example
 * // bootstrap/providers.ts
 * import { AiProvider } from '@rudderjs/ai/server'
 * export default [AiProvider, ...]
 */
export class AiProvider extends ServiceProvider {
  register(): void {}

  async boot(): Promise<void> {
    const cfg = config<AiConfig>('ai')
    const googleCacheRegistry = this.buildGoogleCacheRegistry()

    for (const [name, providerConfig] of Object.entries(cfg.providers)) {
      const driver = providerConfig.driver ?? name
      const build = DRIVERS[driver]
      if (!build) continue
      const instance = build(name, providerConfig, { googleCacheRegistry })
      if (instance === null) {
        // Drivers that need an apiKey return null when it's missing/empty
        // (see requireKey). Skip with a grouped boot notice so the app boots
        // and `AI.use('${name}')` surfaces the standard "not registered"
        // error at the use-site with a clear hint to set the env var.
        bootNotice('ai', `${name} skipped, no API key (set it in .env)`)
        continue
      }
      AiRegistry.register(instance)
    }

    AiRegistry.setDefault(cfg.default)
    AiRegistry.setModels(cfg.models ?? [])
    this.app.instance('ai.registry', AiRegistry)

    // Register conversation store if provided in config
    if (cfg.conversations) {
      setConversationStore(cfg.conversations)
      this.app.instance('ai.conversations', cfg.conversations)
    }

    // Register user-memory store if provided in config (#A4)
    if (cfg.memory) {
      setUserMemory(cfg.memory)
      this.app.instance('ai.memory', cfg.memory)
    }

    // Wire agent.queue() / .broadcast() to Rudder's queue + broadcast.
    await this.configureQueueBridge()

    // Register make:agent scaffolder
    try {
      const { registerMakeSpecs } = await import('@rudderjs/console')
      const { makeAgentSpec } = await import('../commands/make-agent.js')
      registerMakeSpecs(makeAgentSpec)
    } catch { /* rudder console not available */ }
  }

  /**
   * Back the engine's `agent.queue('...').send()` / `.broadcast(channel)` with
   * Rudder's queue and broadcast. Both are optional: when `@rudderjs/queue` is
   * installed, queued AI jobs dispatch through it; when `@rudderjs/broadcast` is
   * also installed, streaming jobs push progress to a channel. When neither is
   * present the engine stays unconfigured and `agent.queue()` surfaces its
   * "register a queue adapter" error at the use-site.
   */
  private async configureQueueBridge(): Promise<void> {
    let dispatch: ((fn: () => void | Promise<void>, options?: { queue?: string; delay?: number }) => Promise<void>) | undefined
    try {
      ({ dispatch } = await import('@rudderjs/queue'))
    } catch { /* @rudderjs/queue not installed - leave agent.queue() unconfigured */ }
    if (!dispatch) return

    let broadcast: ((channel: string, event: string, data: unknown) => Promise<void>) | undefined
    try {
      ({ broadcast } = await import('@rudderjs/broadcast'))
    } catch { /* @rudderjs/broadcast not installed - .broadcast() errors if used */ }

    configureAiQueue({ dispatch, broadcast: broadcast ?? null })
  }

  /**
   * Build a `GoogleCacheRegistry` for Gemini's `cachedContent` resources.
   * When `@rudderjs/cache` is installed and booted, the registered cache
   * adapter is plumbed in for cross-process / cross-restart persistence.
   * Otherwise the registry uses an in-process `Map` and warns once on
   * first use.
   */
  private buildGoogleCacheRegistry(): GoogleCacheRegistry {
    if (this.app.container.has('cache')) {
      const store = this.app.make<CacheStoreLike>('cache')
      return new GoogleCacheRegistry({ store })
    }
    return new GoogleCacheRegistry()
  }
}
