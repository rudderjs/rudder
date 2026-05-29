---
'@rudderjs/cli': minor
---

`rudder make:test` — Laravel-parity test-file scaffolder.

```bash
pnpm rudder make:test User             # tests/User.test.ts — feature test (boots the app via AppTestCase)
pnpm rudder make:test Math --unit      # tests/Math.test.ts — bare node:test, no app boot
```

Defaults to a feature test using `AppTestCase` (the `tests/TestCase.ts` convention from `docs/guide/testing.md`). When the consumer hasn't created `tests/TestCase.ts` yet, the command emits a hint pointing back to the setup snippet — same shape as the doctor's fix hints.

The `--unit` variant generates a stub using only `node:test` + `node:assert/strict` — no app boot, no `@rudderjs/testing`. Right for pure functions, validators, and domain logic.

The filename uses the `.test.ts` suffix so the generated file matches the documented `tsx --test tests/**/*.test.ts` glob without any extra config.
