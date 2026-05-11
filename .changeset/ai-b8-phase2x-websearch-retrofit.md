---
"@rudderjs/ai": minor
---

**B8 Phase 2.x — `WebSearch` provider-native retrofit (Anthropic + Gemini).** Reuses Phase 2's `providerHint` plumbing on `WebSearch.toTool()`. Models that ship a native chat-completions web-search tool now invoke it directly instead of going through the DuckDuckGo fallback — same agent prompt, dramatically better quality on the providers where it matters.

```ts
import { Agent, WebSearch } from '@rudderjs/ai'

class ResearchAgent extends Agent {
  model() { return 'anthropic/claude-3-5-sonnet-latest' }
  tools() {
    return [
      WebSearch.make()
        .domains(['anthropic.com', 'docs.anthropic.com'])
        .maxResults(5)
        .toTool(),
    ]
  }
}
```

**Surface:**

- `WebSearch.toTool()` now sets `providerHint: { type: 'web-search', allowed_domains?, max_uses? }` from the chained `.domains([...])` / `.maxResults(n)` opts. The DuckDuckGo `server` execute stays in place as the fallback.
- `toAnthropicTools` recognizes the hint and emits `{ type: 'web_search_20250305', name: 'web_search', max_uses?, allowed_domains?, blocked_domains?, user_location? }`. Honors a `providerHint.tool` override for forward-compat with future Anthropic web-search variants.
- Gemini — `toGeminiTools` is restructured to return the **already-wrapped top-level array** so native blocks like `{ google_search: {} }` sit as separate top-level entries alongside `{ functionDeclarations: [...] }`. The cache-key build uses the same shape, so cached requests pick up the change automatically.
- OpenAI — `chat.completions` has no native web-search block (it's Responses-API-only), so OpenAI continues to use the DuckDuckGo `server` execute as fallback. Same fallback for any other provider without a native hint match.

**`domains` / `maxResults` semantics across providers:**

| Provider  | `.domains([...])`           | `.maxResults(n)`           |
|---|---|---|
| Anthropic | → `allowed_domains`         | → `max_uses`               |
| Gemini    | ignored (block accepts none) | ignored (block accepts none) |
| OpenAI    | applied via DuckDuckGo `site:` query | bounded by HTML response slice |

**Compatibility:** strictly additive. Apps already using `WebSearch.make().toTool()` get native emission for free on Anthropic + Gemini; behavior on OpenAI / other providers is unchanged.
