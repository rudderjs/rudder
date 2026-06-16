---
'@rudderjs/core': patch
'@rudderjs/ai': patch
'@rudderjs/auth': patch
'@rudderjs/passport': patch
---

feat(core): polish the dev-boot notices block

Refines the non-fatal boot-notices output rendered during `pnpm dev`:

- The notices block now prints AFTER the `App is ready` line as a trailing footnote, instead of being wedged above it.
- The block header uses a solid triangle (`▲`, yellow) instead of the `⚠` warning glyph, which renders narrow/ragged in many monospace fonts; each notice row now leads with a yellow `→` arrow to echo the Vike/Rudder banner lines above it.
- `@rudderjs/ai`'s provider-skip notice is shorter and points at where the key is really set: `<name> skipped, no API key (set it in .env)`.
- `@rudderjs/auth` and `@rudderjs/passport` notice messages drop the em-dash so the block reads consistently.

Dev-output only. Production still prints `[RudderJS] ready` and flushes notices.
