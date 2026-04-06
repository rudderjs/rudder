import { OpenAIAdapter } from './openai.js'
import type { ProviderFactory, ProviderAdapter } from '../types.js'

export interface MistralConfig {
  apiKey: string
  baseUrl?: string | undefined
}

export class MistralProvider implements ProviderFactory {
  readonly name = 'mistral'
  private readonly config: MistralConfig

  constructor(config: MistralConfig) {
    this.config = config
  }

  create(model: string): ProviderAdapter {
    return new OpenAIAdapter(
      {
        apiKey: this.config.apiKey,
        baseUrl: this.config.baseUrl ?? 'https://api.mistral.ai/v1',
      },
      model,
    )
  }
}
