---
'@rudderjs/ai': minor
---

Prompt caching API + Anthropic implementation (A1, sub-PR 1 of 3):

- **`Agent.cacheable()`** declarative method returns `{ instructions?, tools?, messages? }`. The agent loop resolves it into `CacheableMarkers` on `ProviderRequestOptions.cache` so each provider adapter translates to its native primitive.
- **Per-call override** via `agent.prompt(input, { cache: false | {...} })`. `false` disables caching; an object replaces the agent default.
- **Anthropic adapter** translates markers to `cache_control: { type: 'ephemeral' }` on the last content block of each marked region (system, last tool, message at index N-1). String-form system and message content are converted to single text blocks so they can carry the marker.

OpenAI and Google adapters currently ignore the markers — sub-PR follow-ups will add `prompt_cache_key` (OpenAI) and `cachedContent` resource translation (Google). Adapters without caching support continue to run requests uncached.
