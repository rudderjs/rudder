import { ServiceProvider, config } from '@rudderjs/core'
import { AiRegistry } from '../registry.js'
import { setConversationStore, setUserMemory } from '../agent.js'
import { GoogleCacheRegistry, type CacheStoreLike } from '../providers/google-cache-registry.js'
import type { AiConfig, AiProviderConfig, ProviderFactory } from '../types.js'

/**
 * Throw with a clear pointer to the offending config key when an apiKey-
 * requiring provider has no key set. The config type lets `apiKey` be
 * undefined (some drivers — ollama, bedrock — don't need one), so this is
 * the bootstrap-time enforcement point for the drivers that do.
 */
function requireKey(name: string, cfg: AiProviderConfig): string {
  if (!cfg.apiKey) {
    throw new Error(`[RudderJS AI] config('ai').providers.${name} is missing apiKey (driver "${cfg.driver ?? name}").`)
  }
  return cfg.apiKey
}

type DriverDeps = { googleCacheRegistry: GoogleCacheRegistry }
type DriverBuilder = (name: string, cfg: AiProviderConfig, deps: DriverDeps) => Promise<ProviderFactory>

const DRIVERS: Record<string, DriverBuilder> = {
  anthropic: async (name, cfg) => {
    const { AnthropicProvider } = await import('../providers/anthropic.js')
    return new AnthropicProvider({ apiKey: requireKey(name, cfg), baseUrl: cfg.baseUrl })
  },
  openai: async (name, cfg) => {
    const { OpenAIProvider } = await import('../providers/openai.js')
    return new OpenAIProvider({
      apiKey:       requireKey(name, cfg),
      baseUrl:      cfg.baseUrl,
      organization: cfg['organization'] as string | undefined,
    })
  },
  google: async (name, cfg, { googleCacheRegistry }) => {
    const { GoogleProvider } = await import('../providers/google.js')
    return new GoogleProvider({ apiKey: requireKey(name, cfg) }, googleCacheRegistry)
  },
  ollama: async (_name, cfg) => {
    const { OllamaProvider } = await import('../providers/ollama.js')
    return new OllamaProvider({ baseUrl: cfg.baseUrl })
  },
  deepseek: async (name, cfg) => {
    const { DeepSeekProvider } = await import('../providers/deepseek.js')
    return new DeepSeekProvider({ apiKey: requireKey(name, cfg), baseUrl: cfg.baseUrl })
  },
  xai: async (name, cfg) => {
    const { XaiProvider } = await import('../providers/xai.js')
    return new XaiProvider({ apiKey: requireKey(name, cfg), baseUrl: cfg.baseUrl })
  },
  groq: async (name, cfg) => {
    const { GroqProvider } = await import('../providers/groq.js')
    return new GroqProvider({ apiKey: requireKey(name, cfg), baseUrl: cfg.baseUrl })
  },
  mistral: async (name, cfg) => {
    const { MistralProvider } = await import('../providers/mistral.js')
    return new MistralProvider({ apiKey: requireKey(name, cfg), baseUrl: cfg.baseUrl })
  },
  azure: async (name, cfg) => {
    const { AzureOpenAIProvider } = await import('../providers/azure.js')
    if (!cfg.baseUrl) {
      throw new Error(`[RudderJS AI] config('ai').providers.${name} is missing baseUrl (driver "azure" requires it).`)
    }
    return new AzureOpenAIProvider({ apiKey: requireKey(name, cfg), baseUrl: cfg.baseUrl })
  },
  openrouter: async (name, cfg) => {
    const { OpenRouterProvider } = await import('../providers/openrouter.js')
    return new OpenRouterProvider({
      apiKey:   requireKey(name, cfg),
      baseUrl:  cfg.baseUrl,
      siteUrl:  cfg['siteUrl'] as string | undefined,
      siteName: cfg['siteName'] as string | undefined,
    })
  },
  bedrock: async (_name, cfg) => {
    const { BedrockProvider } = await import('../providers/bedrock.js')
    const region = (cfg['region'] as string | undefined) ?? 'us-east-1'
    const credentials = cfg['credentials'] as
      | { accessKeyId: string; secretAccessKey: string; sessionToken?: string }
      | undefined
    return new BedrockProvider(credentials ? { region, credentials } : { region })
  },
  elevenlabs: async (name, cfg) => {
    const { ElevenLabsProvider } = await import('../providers/elevenlabs.js')
    return new ElevenLabsProvider({
      apiKey: requireKey(name, cfg),
      ...(cfg.baseUrl              ? { baseUrl:           cfg.baseUrl                              } : {}),
      ...(cfg['defaultTtsModelId'] ? { defaultTtsModelId: cfg['defaultTtsModelId'] as string       } : {}),
    })
  },
  voyage: async (name, cfg) => {
    const { VoyageProvider } = await import('../providers/voyage.js')
    return new VoyageProvider({
      apiKey: requireKey(name, cfg),
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
      AiRegistry.register(await build(name, providerConfig, { googleCacheRegistry }))
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

    // Register make:agent scaffolder
    try {
      const { registerMakeSpecs } = await import('@rudderjs/console')
      const { makeAgentSpec } = await import('../commands/make-agent.js')
      registerMakeSpecs(makeAgentSpec)
    } catch { /* rudder not available */ }
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
