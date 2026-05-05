---
'@rudderjs/router': patch
---

Two follow-up fixes on the routing surface from the Laravel-13 parity rollout (#213/#214/#215):

- **Balanced-brace scanner is now escape- and character-class-aware.** The `:param{regex}` block scanner used by both `route()` URL generation and route-binding param extraction tracked depth via `{` / `}` only. Two real edge cases bit through:
  - `whereIn(['a}b'])` regex-escapes `}` to `\}`. The naive scanner treated the `\}` as a block terminator, mis-extracted the param name (`:idc)}` instead of `:id`), and emitted broken URLs from `route()`.
  - `where(/[^}]+/)` then a follow-up `where(...)` call: the inner `}` inside `[^}]` would terminate the block early, leaving `]+}` junk in the rewritten path.

  Both `stripRegexSegments()` and `RouteBuilder.where()`'s scanner now share a single `consumeBraceBlock()` helper that recognises `\<char>` escape pairs and `[ ... ]` character-class context. Built-in shortcuts (`whereNumber`, `whereUuid`, etc.) are unchanged because none of their patterns hit either edge case.

- **`RouteBuilder.where()` docstring now matches code reality.** The previous wording claimed `^` / `$` anchors were "ignored, since Hono anchors per-segment" — only flags are dropped automatically (via `RegExp.source`). Anchors pass through; Hono's per-segment anchoring makes them harmless redundancy. Updated to describe what actually happens.
