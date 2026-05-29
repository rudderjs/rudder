---
'@rudderjs/cli': minor
---

`rudder test` — unified test-runner entry point.

```bash
pnpm rudder test                                      # run every test under tests/
pnpm rudder test User                                 # filter by name pattern
pnpm rudder test tests/UserController.test.ts         # run one specific file
pnpm rudder test --watch                              # re-run on file changes
pnpm rudder test --coverage                           # Node --experimental-test-coverage
pnpm rudder test --bail                               # stop on first failure
pnpm rudder test --reporter=spec                      # spec / dot / tap / junit
```

Pairs with the just-shipped `rudder make:test` so the test-driven workflow has a one-liner from scaffold to run:

```bash
pnpm rudder make:test User
pnpm rudder test User
```

Spawns `tsx --test` under the hood against the documented `tests/` directory. Auto-locates `tsx` in `node_modules/.bin` (walks up to handle monorepo hoisting); prints a clear install hint when it's missing. Skip-boot — fast startup, doesn't need the app to be bootable.

Positional arg semantics:

- Ends in `.ts` → file path (Node runs just that file)
- Anything else → `--test-name-pattern=<arg>` (matches `describe` / `it` labels)

Both can be combined with `--filter <regex>` — explicit `--filter` wins over a non-`.ts` positional.
