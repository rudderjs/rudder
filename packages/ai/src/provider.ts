import { ServiceProvider, type Application } from '@rudderjs/core'
import { AiRegistry } from './registry.js'
import { setConversationStore } from './agent.js'
import type { AiConfig, ConversationStore } from './types.js'

/**
 * Create the AI ServiceProvider from config.
 *
 * @example
 * // bootstrap/providers.ts
 * import { ai } from '@rudderjs/ai'
 * export default [ai(configs.ai), ...]
 */
export function ai(config: AiConfig): new (app: Application) => ServiceProvider {
  class AiServiceProvider extends ServiceProvider {
    register(): void {}

    async boot(): Promise<void> {
      for (const [name, providerConfig] of Object.entries(config.providers)) {
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

      AiRegistry.setDefault(config.default)
      AiRegistry.setModels(config.models ?? [])
      this.app.instance('ai.registry', AiRegistry)

      // Register conversation store if provided in config
      if ((config as AiConfig & { conversations?: ConversationStore }).conversations) {
        const store = (config as AiConfig & { conversations?: ConversationStore }).conversations!
        setConversationStore(store)
        this.app.instance('ai.conversations', store)
      }
    }
  }

  return AiServiceProvider
}
