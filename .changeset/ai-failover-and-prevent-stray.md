---
'@rudderjs/ai': minor
---

Two AI ergonomics/correctness fixes:

- **Provider failover for `Image` / `Audio` / `Transcription`** — `.failover(...models)` on each fluent builder, mirroring the agent loop's `failover()`. Tries the primary first, then each fallback in order; swallows individual errors and surfaces only the last if every candidate fails. Backed by a new shared `tryWithFailover()` helper in `registry.ts`.
- **`AiFake.preventStrayPrompts()`** — strict-mode toggle that throws on any prompt without a matching `respondWithSequence` entry. Without it, an unscripted prompt silently falls back to the ambient `respondWith` default, which lets tests pass even when they accidentally trigger an extra prompt. Under strict mode, only sequence entries count as valid responses; ambient `respondWith` is ignored.
