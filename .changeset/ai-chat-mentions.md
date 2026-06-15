---
"@rudderjs/ai": minor
---

Add `@rudderjs/ai/chat-mentions` for `@slug` agent routing in chat UIs.

A chat UX where the user types `@<agent-slug>` to explicitly invoke an agent (overriding the orchestrator's routing) is generic across chat panels, bots, and CLIs, but every consumer had to hand-roll the parsing and the system-prompt rule. This subpath ships both:

- `parseMentions(message, knownSlugs)` extracts and validates `@<slug>` tokens (unknown mentions stay as plain text, `email@host` is not a mention), dedupes in first-seen order, lower-cases, and returns the matched slugs plus the message with the tokens stripped.
- `buildMentionRoutingRule(slugs, opts?)` renders a system-prompt rule forcing the orchestrator to dispatch the mentioned agents in order. The dispatch tool name and argument key are parameterized (`toolName` / `argKey`, default `run_agent` / `agentSlug`).

`MENTION_REGEX` is exported too; `parseMentions` clones it internally so the global's `lastIndex` never leaks across calls.

```ts
import { parseMentions, buildMentionRoutingRule } from '@rudderjs/ai/chat-mentions'

const { slugs, cleaned } = parseMentions('@seo audit this', knownSlugs)
const rule = buildMentionRoutingRule(slugs)
```
