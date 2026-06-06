# Correctness sweep — 2026-06-06

Two bug classes, motivated by pilotiq-demo finds #933 / #934 / #936:

- **Class A** — docs-vs-behavior drift: every executable claim in `docs/guide/**` verified against source (commands/flags/defaults, config keys, import paths vs `package.json#exports`, behavioral claims, signatures).
- **Class B** — tests that bypass the real wiring: hand-seeded state, internal-function tests where users go through an entry point, harnesses injecting preconditions the artifact should carry.

Method: 13 verification agents (file:line evidence required), every finding independently re-verified before fixing. Code bugs got one PR each (fix + real-path regression test + changeset); docs corrections batched by area in the docs PR carrying this file.

## Outcomes

### Code bugs found & fixed

| Bug | Class | PR |
|---|---|---|
| `model:prune` walks an always-empty `ModelRegistry` — registration is lazy (first query), nothing sweeps `app/Models/**` in a prune run → feature dead in every real CLI invocation; tests hand-seeded the registry (exact #934 anatomy) | B | #942 |
| `req.ip` undefined in every default deployment (`extractIp` returned undefined unless `TRUST_PROXY=true`) → every ip-keyed `RateLimit` shared ONE `'unknown'` bucket; scaffolded 10/min auth limiter = site-wide login throttle; dev `rudderjs:ip` plugin was dead code. Fixed with Laravel `Request::ip()` socket fallback (srvx `request.ip`/`runtime.node`, `env.incoming`, dev header stand-in) + one-time RateLimit warning. Surfaced by the Class B find that RateLimit tests keyed everything to `'unknown'` (inert `x-real-ip` fixtures) | B→A | #944 |
| Scaffolder smoke + canary booted `node dist/server/index.mjs` directly and the smoke **injected `NODE_ENV=production` itself** — the exact precondition the `start` script carries (#936 recurrence; deleting the prefix would stay green). Both now run the real `start` script with NODE_ENV stripped | B | #945 |
| `module:publish` merged shards into `prisma/schema.prisma`, which Prisma never reads on the scaffolder-default multi-file layout (`prisma.config.ts` → `prisma/schema/` dir) → silent no-op in every scaffolded app | A→code | #946 |

### Docs corrections (this PR, batched by area)

~50 verified drift fixes across 25 pages; the P1s (copy-paste breaks):

- auth: `PasswordBroker` static-call example (instance API), `hash()` → `Hash.make()`, passport middleware/handler arg order, `Auth.user()` soft-fail claim, `RequireAuth` HTML-redirect claim
- middleware: same arg-order bug — silently disabled the bearer guard
- requests: `Session.pull()` doesn't exist; `req.ip` semantics (updated to the #944 behavior)
- queues: `Queue.assertPushed` statics → fake-instance methods; `bullmq` CLI doesn't exist
- events: `new EventFake()` doesn't install; assertions take name strings; listener errors are NOT isolated
- cache: `Cache.store(name)` doesn't exist (section rewritten); `keyPrefix` → `prefix`; `tls: true` → `rediss://`
- storage: `temporaryUrl(path, 3600)` throws (Date required); `put(..., { visibility })` silently ignored (security-relevant)
- broadcasting: presence handlers receive bare values
- sync: `vendor:publish --tag=sync-schema` unregistered (manual `SyncDocument` model documented); `@rudderjs/sync/tiptap` subpath not exported; snapshot/compaction claim removed (append-only)
- notifications/rudder.md: `make:notification` doesn't exist; `make:mail`/`make:command` output paths
- configuration: `app().make('config.server')` throws → `config('server')`
- container: `alias('log', Logger)` throws → string token
- logging: `config/logging.ts` → `config/log.ts` (provider reads the `log` key)
- localization: `{2,4}` plural-range syntax not implemented
- testing/ai/mcp: `assertImageGenerated`/`assertAudioGenerated` names; `mcp:start <name>` runner; `current-weather` kebab-case; `until`/`tokenLimit`/`noTokensUsed` stop conditions don't exist
- database/drizzle: **MySQL IS supported** (doc steered users away from a supported config); `disconnect()` scope
- database/prisma: `import { database }` doesn't exist; no DATABASE_URL scheme auto-detection (defaults to sqlite)
- scheduling: `.weekdays().dailyAt()` does not compose (each helper overwrites the cron)
- quality: CI matrix is Node 22+24

### Open / follow-ups

- **pageContext enhancers dead with no `app/Views/`** (session/auth/localization register enhancers unconditionally; the scanner emits `pages/+onCreatePageContext.ts` only when views exist). Decision: views-required is the contract — add a scanner contract test (hook emitted with views, skipped without) + docs note. Edge-only: scaffolded apps always have views. *(pending small PR)*
- **Telescope `ModelCollector`**: all production coverage rides the `onRegister` subscription (initial `registry.all()` pass is empty at boot — lazy registration). No test guards the subscription; if dropped, model recording dies silently (#934 shape, currently correct). Suggested: a `model.test.ts` that registers a model after collector boot. *(optional, noted)*
- `vendor:publish --tag=sync-schema`: docs now document the manual model; registering a real publish tag in `SyncProvider` would restore the one-command path. *(feature, post-sweep)*
- `cli/src/commands/add.ts:72` hint suggests `rudder make:notification Welcome` (nonexistent). Trivial string fix — bundle with the next CLI PR.
- `rudderjs-com` site sync — handled separately after these PRs merge (out of scope per brief).
- `doctor.md` "36 checks" count is install-dependent (~39 ids in-repo) — left as-is, inherently fragile rather than wrong.

## Class A — page-by-page verdicts

Skipped (swept 2026-06-05, #939): installation, tutorial, database.md, database/migrations, deployment, directory-structure, index.
Note: no `session.md` exists — session claims live in auth/requests pages (covered).

| Page | Verdict |
|---|---|
| authentication.md | 5 fixed (this PR) |
| authorization.md | clean |
| routing.md | clean |
| middleware.md | 1 fixed |
| controllers.md | clean |
| rate-limiting.md | 3 fixed |
| requests.md | 3 fixed |
| responses.md | clean (cross-ref only) |
| validation.md | 2 fixed |
| queues.md | 2 fixed |
| scheduling.md | 2 fixed |
| mail.md | 1 fixed |
| notifications.md | 4 fixed |
| cache.md | 3 fixed |
| storage.md | 3 fixed |
| events.md | 3 fixed |
| broadcasting.md | 1 fixed (+stale code comment noted) |
| sync.md | 4 fixed |
| rudder.md | 6 fixed |
| configuration.md | 2 fixed |
| service-providers.md | clean |
| tinker.md | clean |
| doctor.md | clean (count caveat noted) |
| frontend.md | clean |
| typed-views.md | clean |
| typed-routes.md | 1 fixed |
| prerender.md | clean |
| testing.md | 1 fixed |
| mcp.md | 2 fixed |
| ai.md | 2 fixed |
| http-client.md | clean |
| logging.md | 2 fixed |
| localization.md | 2 fixed |
| hashing.md | clean |
| encryption.md | clean |
| error-handling.md | 2 fixed |
| container.md | 1 fixed |
| facades.md | clean |
| contracts.md | 1 fixed |
| application.md | clean |
| lifecycle.md | clean |
| computer-use.md | clean |
| vector-stores.md | 1 fixed |
| when-not-to-use.md | clean |
| quality.md | 1 fixed |
| database/drizzle.md | 2 fixed (MySQL P1) |
| database/prisma.md | 3 fixed |
| database/native.md | clean |
| database/connections.md | clean |
| database/models.md | clean |
| database/query-builder.md | clean |
| database/resources.md | clean |

## Class B — area verdicts

| Area | Verdict |
|---|---|
| cli / orm / database / orm-prisma / orm-drizzle | 1 finding → fixed in #942 (`model:prune`); schema-types (#934 fix), migrate --connection, db-bridge seams all checked OK |
| core / router / middleware / session / auth / server-hono / view / vite | 2 findings → RateLimit ip keying fixed in #944; enhancers-without-views = open follow-up. defaultProviders manifest tests, reboot single-flight, session/auth boot wiring all checked OK |
| create-rudder + smoke + CI workflows | 1 finding → fixed in #945 (NODE_ENV injection / never runs `start`). Env templating, prisma mirror, native-pg DATABASE_URL rewrite all checked OK. Coverage-breadth note: `pnpm dev` never smoke-tested e2e (command:list full-boot covers provider wiring) |
| queue / mail / notification / cache / storage / broadcast / sync / schedule / telescope / pulse / horizon | no findings; telescope ModelCollector untested-onRegister noted above |
