---
"@rudderjs/telescope": patch
---

Internal cleanup: document hidden contracts in JSDoc, tighten 4 casts (`as unknown as` 12→8), collapse the duplicated list-slug logic between `routes.ts` and `EntryList.ts` into a shared `toApiSlug()` helper, and replace the `.map(...).join('')` SafeString footgun in `renderToolCalls`/`renderSteps` with idiomatic `html` template interpolation.

No public API or behavior change. The remaining 8 casts are peer-bridge casts in collectors (`ai`, `mcp`, `model`, `notification`, `query`, `schedule`, `mail`) — load-bearing because telescope is downstream of those packages; documented in `CLAUDE.md` so the next audit doesn't relitigate.
