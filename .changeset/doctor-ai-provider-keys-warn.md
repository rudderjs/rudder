---
'@rudderjs/ai': patch
---

`rudder doctor` ai:provider-keys — downgrade "all cloud keys missing" from error to warn

The check now warns (was: errored) when every declared cloud provider in
`config/ai.ts` is missing its API key. The app boots fine without keys —
failures only surface when an AI call is actually made (401 from the
provider), so blocking `predev` on a runtime-intent condition forced CI /
smoke / no-AI-test environments to write fake keys to pass the gate.

Mirrors the ethos applied to `env:app-key` in #619 and `env:dotenv-loadable`
in #626: error on "the app won't boot at all", warn on "the app boots but
a runtime path will fail later". Severity-only change — message and
detail text unchanged; fix-text gains the same "(or remove the providers
from config/ai.ts if unused)" parenthetical the partial-keys branch
already used, so both branches read consistently.

Nothing fails-closed becomes fails-open — every state that returned
`error` before now returns `warn` with the same message.
