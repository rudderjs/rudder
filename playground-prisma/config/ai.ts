import { Env } from '@rudderjs/core'
import type { AiConfig } from '@rudderjs/ai'

export default {
  default: Env.get('AI_MODEL', 'anthropic/claude-sonnet-4-5'),

  models: [
    { id: 'anthropic/claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
    { id: 'openai/gpt-4o', label: 'GPT-4o' },
    { id: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  ],

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
