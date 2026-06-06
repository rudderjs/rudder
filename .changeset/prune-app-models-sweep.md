---
"@rudderjs/orm": patch
---

`model:prune` now sweeps `app/Models/**` into the `ModelRegistry` before discovery. Model registration is lazy (a model registers on its first query, which never fires before discovery in a prune run), so in every real CLI invocation the registry was empty and the command always printed "No prunable models registered." — the feature was unreachable outside tests that hand-seeded the registry. Same fix shape as the `schema:types` cast-folding sweep (#934).
