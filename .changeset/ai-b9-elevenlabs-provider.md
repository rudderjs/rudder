---
"@rudderjs/ai": minor
---

**B9 — ElevenLabs provider for premium TTS + STT.** New `ElevenLabsProvider` implements `TextToSpeechAdapter` + `SpeechToTextAdapter` against ElevenLabs's REST API. Raw `fetch` adapter — no SDK peer dep (matches the Jina / Cohere shape). Wired through `AiProvider` via `driver: 'elevenlabs'` so apps declare it in `config/ai.ts` alongside their LLM provider.

```ts
// config/ai.ts
import { env } from '@rudderjs/support'

export default {
  default: 'openai/gpt-4o',
  providers: {
    openai:     { driver: 'openai',     apiKey: env('OPENAI_API_KEY')!     },
    elevenlabs: { driver: 'elevenlabs', apiKey: env('ELEVENLABS_API_KEY')! },
  },
}
```

```ts
// TTS — model string is `<provider>/<voice_id>`; Rachel = 21m00Tcm4TlvDq8ikWAM
await AudioGenerator
  .of('Hello world')
  .model('elevenlabs/21m00Tcm4TlvDq8ikWAM')
  .format('mp3')
  .generate()

// STT — model string is `<provider>/<model>`; scribe_v1 is the only model today
await Transcription
  .of(audioBuffer)
  .model('elevenlabs/scribe_v1')
  .transcribe()

// Failover from OpenAI TTS → ElevenLabs (existing AudioGenerator surface)
await AudioGenerator
  .of('Hello')
  .model('openai/tts-1-hd')
  .failover('elevenlabs/21m00Tcm4TlvDq8ikWAM')
  .generate()
```

**Conventions:**

- The model string after `elevenlabs/` is a **voice id** for TTS, an actual model id for STT. The TTS model id ships from `ElevenLabsConfig.defaultTtsModelId` (default `eleven_multilingual_v2`).
- `format` maps: `mp3` → `mp3_44100_128`, `opus` → `opus_48000_128`. `wav` / `aac` / `flac` throw clearly — re-encode at the app layer or use a provider with native support.
- `speed` is **ignored** by this adapter — ElevenLabs doesn't expose a top-level speed multiplier on the TTS endpoint.

**Manual registration alternative** (matches Jina / Cohere precedent — no `AiProvider` config needed):

```ts
import { AiRegistry, ElevenLabsProvider } from '@rudderjs/ai'

AiRegistry.register(new ElevenLabsProvider({
  apiKey: process.env.ELEVENLABS_API_KEY!,
}))
```
