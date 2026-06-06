---
'@rudderjs/support': minor
'@rudderjs/vite': minor
'@rudderjs/cli': minor
---

Typed `Env`: `Env.get('APP_NAME')` (and `getNumber`/`getBool`/`has`/`env()`) now autocompletes the keys your app declares. `@rudderjs/vite`'s new env scanner parses `.env.example` — the committed contract, never the secret `.env` — and emits `.rudder/types/env.d.ts` augmenting the new `EnvRegistry` interface in `@rudderjs/support`. Runs on dev/build, re-emits when `.env.example` changes, and the loose `string` overload stays for keys packages read that apps don't declare.

New `rudder env:sync` command (skip-boot): regenerates the registry AND diffs `.env` against `.env.example` — missing keys are flagged, `--fix` appends them with their example values (or creates `.env` wholesale when absent). Keys only your `.env` carries are reported but never deleted.
