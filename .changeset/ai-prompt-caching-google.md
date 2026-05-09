---
'@rudderjs/ai': minor
---

Prompt caching for Google / Gemini (A1, sub-PR 3 of 3):

The Google adapter now translates `Agent.cacheable()` markers into Google's stateful `cachedContent` API. Marked regions (system + tools + leading-N messages, scoped by model id) are uploaded once via `caches.create`, then subsequent requests reference the resulting `cachedContents/*` resource and send only the fresh tail — typical input-token savings of 75% for long stable prefixes.

A new `GoogleCacheRegistry` owns the `hash → resource-name` map, dedups concurrent same-key creates inside a worker, memoizes "below model minimum" failures for 5 minutes (so tight loops don't pound the create endpoint), and recreates transparently on stale-resource 404s. When `@rudderjs/cache` is installed and registered, the registry is auto-wired to the framework cache for cross-process / cross-restart persistence; otherwise it falls back to an in-process `Map` and warns once.

A new `ttl` field on `CacheableConfig` controls Google's per-resource TTL (default `'1h'`, accepts duration strings like `'30m'`, `'6h'`, `'1d'`). Anthropic and OpenAI ignore the field — their cache layers have no per-call TTL knob.

The shared cyrb53 hash helper is now exported from `packages/ai/src/util/hash.ts` and consumed by both the OpenAI and Google adapters.
