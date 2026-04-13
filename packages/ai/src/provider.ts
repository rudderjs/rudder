import { ServiceProvider, config } from '@rudderjs/core'
import { AiRegistry } from './registry.js'
import { setConversationStore } from './agent.js'
import type { AiConfig, ConversationStore } from './types.js'

/**
 * AI ServiceProvider — reads config from `config('ai')`.
 *
 * @example
 * // bootstrap/providers.ts
 * import { AiProvider } from '@rudderjs/ai'
 * export default [AiProvider, ...]
 */
export class AiProvider extends ServiceProvider {
  register(): void {}

  async boot(): Promise<void> {
    const cfg = config<AiConfig>('ai')
    for (const [name, providerConfig] of Object.entries(cfg.providers)) {
        const driver = providerConfig.driver ?? name

        if (driver === 'anthropic') {
          const { AnthropicProvider } = await import('./providers/anthropic.js')
          AiRegistry.register(new AnthropicProvider({
            apiKey: providerConfig.apiKey!,
            baseUrl: providerConfig.baseUrl,
          }))
        } else if (driver === 'openai') {
          const { OpenAIProvider } = await import('./providers/openai.js')
          AiRegistry.register(new OpenAIProvider({
            apiKey: providerConfig.apiKey!,
            baseUrl: providerConfig.baseUrl,
            organization: providerConfig['organization'] as string | undefined,
          }))
        } else if (driver === 'google') {
          const { GoogleProvider } = await import('./providers/google.js')
          AiRegistry.register(new GoogleProvider({
            apiKey: providerConfig.apiKey!,
          }))
        } else if (driver === 'ollama') {
          const { OllamaProvider } = await import('./providers/ollama.js')
          AiRegistry.register(new OllamaProvider({
            baseUrl: providerConfig.baseUrl,
          }))
        } else if (driver === 'deepseek') {
          const { DeepSeekProvider } = await import('./providers/deepseek.js')
          AiRegistry.register(new DeepSeekProvider({
            apiKey: providerConfig.apiKey!,
            baseUrl: providerConfig.baseUrl,
          }))
        } else if (driver === 'xai') {
          const { XaiProvider } = await import('./providers/xai.js')
          AiRegistry.register(new XaiProvider({
            apiKey: providerConfig.apiKey!,
            baseUrl: providerConfig.baseUrl,
          }))
        } else if (driver === 'groq') {
          const { GroqProvider } = await import('./providers/groq.js')
          AiRegistry.register(new GroqProvider({
            apiKey: providerConfig.apiKey!,
            baseUrl: providerConfig.baseUrl,
          }))
        } else if (driver === 'mistral') {
          const { MistralProvider } = await import('./providers/mistral.js')
          AiRegistry.register(new MistralProvider({
            apiKey: providerConfig.apiKey!,
            baseUrl: providerConfig.baseUrl,
          }))
        } else if (driver === 'azure') {
          const { AzureOpenAIProvider } = await import('./providers/azure.js')
          AiRegistry.register(new AzureOpenAIProvider({
            apiKey: providerConfig.apiKey!,
            baseUrl: providerConfig.baseUrl!,
          }))
        }
      }

    AiRegistry.setDefault(cfg.default)
    AiRegistry.setModels(cfg.models ?? [])
    this.app.instance('ai.registry', AiRegistry)

    // Register conversation store if provided in config
    if ((cfg as AiConfig & { conversations?: ConversationStore }).conversations) {
      const store = (cfg as AiConfig & { conversations?: ConversationStore }).conversations!
      setConversationStore(store)
      this.app.instance('ai.conversations', store)
    }

    // Register make:agent scaffolder
    try {
      const { registerMakeSpecs } = await import('@rudderjs/rudder')
      const { makeAgentSpec } = await import('./commands/make-agent.js')
      registerMakeSpecs(makeAgentSpec)
    } catch { /* rudder not available */ }
  }
}
