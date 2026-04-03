import { Env } from '@boostkit/core'
import type { AiConfig } from '@boostkit/ai'

export default {
  default: Env.get('AI_MODEL', 'anthropic/claude-sonnet-4-5'),

  providers: {
    anthropic: {
      driver: 'anthropic',
      apiKey: Env.get('ANTHROPIC_API_KEY', ''),
    },

    openai: {
      driver: 'openai',
      apiKey: Env.get('OPENAI_API_KEY', ''),
    },

    google: {
      driver: 'google',
      apiKey: Env.get('GOOGLE_AI_API_KEY', ''),
    },

    ollama: {
      driver:  'ollama',
      baseUrl: Env.get('OLLAMA_BASE_URL', 'http://localhost:11434'),
    },
  },
} satisfies AiConfig
