---
"@rudderjs/ai": minor
---

**`AiProvider` now skips providers with empty `apiKey` instead of crashing on boot.**

Previously, any apiKey-requiring driver (anthropic, openai, google, deepseek, xai, groq, mistral, azure, openrouter, elevenlabs, voyage) would throw `[RudderJS AI] config('ai').providers.X is missing apiKey` from `boot()` if its `apiKey` was empty — killing `pnpm dev` before the framework finished initializing. Fresh-scaffolded apps with the default 3-provider config (anthropic + openai + google reading from env vars) couldn't boot until **all three** keys were set.

Now `AiProvider.boot()` skips empty-key providers with a one-line warning per skip:

```
[RudderJS AI] Skipped provider "anthropic" (driver "anthropic"): apiKey is empty.
Set config('ai').providers.anthropic.apiKey (typically via an env var) to enable.
```

The app boots cleanly. The user gets actionable signal at startup. Calling `AI.use('anthropic')` later surfaces the standard `[RudderJS AI] Unknown AI provider "anthropic"` error at the use-site, with the boot warning explaining why.

Matches Laravel's "drivers as data, missing credentials don't kill the framework" pattern — same as how Cache/Mail/Storage handle unconfigured drivers. Providers with valid keys, and `apiKey`-less drivers like ollama / bedrock, are unaffected.

No API change beyond the boot-time behavior. Marked minor (not patch) because the observable startup behavior changes — existing apps that relied on the boot-time throw to surface misconfig will need to handle that signal at use-time or check `AiRegistry.getFactory(name)` explicitly.
