---
"@rudderjs/ai": patch
---

**Type-tightening + clearer config errors in `@rudderjs/ai/server`.** Three internal cleanups, no public-API change.

- Drop the `as unknown as StreamChunk` casts on the loop's pending-state yields. The `StreamChunk` union already lists `'pending-client-tools'` and `'pending-approval'` — the casts were dead weight.
- Replace the duck-typed `(a as any).tools === 'function'` narrowing for `HasTools` / `HasMiddleware` with proper type-guard helpers. Removes the last `as any` in `agent.ts`.
- **`AiProvider.boot` now fails loud on a missing `apiKey`** for drivers that need one. The previous code asserted `cfg.apiKey!` and silently passed `undefined` to the provider constructor on misconfigured config; you now get `[RudderJS AI] config('ai').providers.<name> is missing apiKey (driver "<driver>")` at boot. `azure` similarly fails fast on a missing `baseUrl`. Drivers that don't need a key (`ollama`, `bedrock`) are unaffected.
- The 13-branch `if/else` driver dispatch in `server/provider.ts` collapses to a `DRIVERS` map keyed by driver name — same set of supported drivers, ~30% smaller, easier to add new ones.

If your `config('ai').providers` is already correct, nothing changes. If a misconfigured provider was working before only because its driver tolerated `apiKey: undefined`, you'll now get a clear error at startup instead.
