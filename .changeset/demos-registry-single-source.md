---
"create-rudder-app": minor
---

feat: single-source-of-truth DEMOS registry consumed by both scaffolder and playground

Adds `description` (long card text), `packages` (rendered list of `@rudderjs/*`
deps the demo exercises), and optional `title` (card title that can differ
from the multiselect `label`) to `DemoSpec`. The scaffolder's `index-view.ts`
template is rewritten to map over `DEMOS` instead of hand-coding the same
14 cards inline, and a new `./demos-registry` subpath export lets the
playground import the registry as a workspace dependency:

```ts
import { DEMOS, demoHref, demoTitle } from 'create-rudder-app/demos-registry'
```

Adding a new demo now means editing one entry in `templates/demos/registry.ts`
— the scaffolder's generated `/demos` index AND the playground's `/demos`
page pick up the new card automatically. Previously the metadata was
duplicated across three places (registry gating spec, scaffolder
`index-view.ts`, playground `Index.tsx`); each demo addition required
edits in all three or one would silently drift.

The playground keeps its `Billing` demo as the only `playgroundExtras`
entry — cashier-paddle was permanently dropped from the scaffolder
(needs real Paddle vendor account + webhook URL), so it can't live in
the shared registry. New playground-only entries follow the same
one-liner pattern.

Snapshot baseline unchanged (64 files, 65272 bytes, hash matches) —
the refactor is byte-identical to the previous output.
