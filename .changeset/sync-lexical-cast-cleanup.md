---
"@rudderjs/sync": patch
---

Internal cleanup of the `@rudderjs/sync/lexical` adapter — deferred follow-up from the previous sync cleanup. No public API changes.

- Standardize on the existing `InnerDeltaItem` type alias from `lexical/types.ts` everywhere a `Y.XmlText.toDelta()` result is consumed. Replaces 7 inline `as Array<{ insert: unknown }>` casts across `text.ts` and `lexical/index.test.ts`.
- Drop redundant `as Y.XmlText` / `as Y.XmlElement` post-`instanceof` casts in `text.ts` and the test file (4 casts) — TypeScript already narrows `entry.insert` to the matched type inside the `instanceof` branch.
- Drop two unused `// eslint-disable-next-line @typescript-eslint/no-explicit-any` directives in `blocks.ts` — the underlying casts use `unknown`, not `any`, so the rule never fired.
- Restructure `rewriteText` in `text.ts` to merge the two passes over `rootDelta` (paragraph-nodes + per-paragraph offsets) into one — collects `{ node, offset }` pairs, then iterates `existing.slice(newParagraphs.length).reverse()` for truncation and `newParagraphs.slice(existing.length)` for extension. Eliminates 3 non-null assertions (`existingNodes[i]!` / `newParagraphs[i]!` / `offsets[i]!`).
- Replace `paragraphOffsets[pIdx]!` in `insertBlock` with `paragraphOffsets[pIdx] ?? totalLen`. The explicit `>= paragraphCount` guard above already covers OOB, but the `??` keeps `noUncheckedIndexedAccess` happy without the lint-flagged non-null assertion.
- Test helper: `rooms()` accessor for the 4 repeated `G[ROOMS_KEY] as Map<string, { doc: Y.Doc }>` reads.

`@rudderjs/sync` package-wide lint warnings: 7 → 0 (lexical/ adapter).
