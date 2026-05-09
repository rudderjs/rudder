---
'@rudderjs/ai': minor
---

Prompt caching for OpenAI (A1, sub-PR 2 of 3):

The OpenAI adapter now translates `Agent.cacheable()` markers into a `prompt_cache_key` on each request. OpenAI caches prompts automatically once they exceed 1024 tokens; the key is a routing affinity hint so repeat requests with the same cacheable prefix land on the backend that already has the prefix cached, lifting cache hit rates.

The key is a stable cyrb53 hash of the marked regions:
- `instructions: true` → hashes the system message content
- `tools: true` → hashes the tool definitions
- `messages: N` → hashes the first N non-system messages

Regions outside the markers don't affect the key, so changes to later messages (the unstable tail of a conversation) don't fragment cache routing. The hash is pure JS — `@rudderjs/ai`'s main entry stays runtime-agnostic.

Per-call override via `agent.prompt(input, { cache: false | {...} })` continues to work. Google adapter translation (`cachedContent` resources) is the remaining sub-PR.
