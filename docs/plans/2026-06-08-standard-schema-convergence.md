# Standard Schema convergence

**Filed:** 2026-06-08
**Status:** plan — not started. Code-quality / decoupling arc, not user-facing. Not urgent; do when a slot opens, deliberately + tested. Follows the typed-responses arc (#995) which introduced `StandardSchemaV1` in `@rudderjs/contracts`.

## Context & principle

`.responds()` (PR #995) types its schema param against **Standard Schema** (`StandardSchemaV1`, the `~standard` interface Zod 4 / Valibot / ArkType implement), while the validation methods next to it (`.body()`/`.query()`) still type against `ZodType`. That's a mixed convention in one file — the debt this arc pays down.

**The principle to converge on (write it into the relevant CLAUDE.mds):**
> Public API boundaries where a **user hands the framework a schema** accept **Standard Schema**, not `ZodType`. Internal schema construction and zod-specific utilities stay on Zod. Zod remains the default/recommended validator.

This decouples the framework from Zod-the-library (no repeat of the zod 3→4 migration) and lets apps bring Valibot/ArkType — but the "bring any validator" payoff is unrealized until there's demand, so the **near-term driver is consistency**, not capability.

## Audit — the only sites in scope (user-supplied schema boundaries)

| Subsystem | Sites | Validates at runtime? | Difficulty |
|---|---|---|---|
| **router** | `RouteOptions`, `.body()`/`.query()` (`index.ts`), `buildBodyValidator`/`buildQueryValidator` | yes (`safeParse` → `ValidationError`) | **easy** |
| **ai** | `asTool` (`agent.ts`), `HandoffOptions` (`handoff.ts`), `ToolBuilder` (`tool.ts`) | yes (tool input parse) | **medium** |
| **core** | `FormRequest` (`validation.ts`), `validate()`, `validateWith()` | yes (`safeParse`/`parse` → `ValidationError`) | **hard — see wrinkle** |

**Explicitly NOT in scope (keep on Zod):** `@rudderjs/mcp`'s `zodToJsonSchema()` (a deliberately zod-specific converter), and all *internal* schema construction (the framework building its own `z.object(...)`). Standard Schema is an interface — you still need a concrete validator to build schemas.

## The mechanical core (shared by every site)

Today each validating site does:
```ts
const result = schema.safeParse(value)
if (!result.success) throw new ValidationError(zodIssuesToErrors(result.error))
value = result.data
```
Standard Schema's equivalent — and it maps to the **same** `{ [path]: string[] }` error shape:
```ts
const result = await schema['~standard'].validate(value)   // may be async; these sites are already async
if (result.issues) throw new ValidationError(standardIssuesToErrors(result.issues))
value = result.value
```
where `standardIssuesToErrors` mirrors the existing `zodIssuesToErrors` (issue `{ message, path }` → `path.join('.') || 'root'` → `string[]`).

**Deliverable: one shared helper** — add `standardValidate(schema, value)` (+ `standardIssuesToErrors`) to `@rudderjs/contracts` (where `ValidationError` already lives, and which the validators already import). Returns a normalized `{ value } | { errors: Record<string,string[]> }`. Every site funnels through it — one validation funnel, no per-site drift. The existing `zodIssuesToErrors` copies in router + core collapse into it.

## The wrinkle — FormRequest's `messages()` is Zod-specific

`FormRequest` lets you override messages via `messages()`, implemented with Zod's `$ZodErrorMap` (`buildErrorMap` in `validation.ts`). **Standard Schema has no error-map equivalent.** So FormRequest cannot be *fully* validator-agnostic without dropping `messages()`. Options (decide during the core phase):
1. **Keep FormRequest typed against Standard Schema but special-case Zod** for the `messages()` path (detect `~standard.vendor === 'zod'`, use the error map; non-Zod validators get default messages). Pragmatic; preserves behavior.
2. **Leave `FormRequest`/`validate*` on `ZodType`** and only converge router + ai. Honest: FormRequest leans on Zod-specific features, so coupling it is defensible.

Recommend **(2) for the first pass** — converge router + ai (clean), leave core/FormRequest on Zod with a documented note that it's Zod-coupled by design (the `messages()` feature). Revisit only if a user wants FormRequest on another validator.

## Phases (one PR each, in difficulty order)

- **Phase 0 — shared helper.** `standardValidate` + `standardIssuesToErrors` in contracts, with tests (success, issues→error-map, async validate, root-path). No call-site changes yet. Lands the funnel.
- **Phase 1 — router.** Retype `RouteOptions`/`.body()`/`.query()`/`buildBodyValidator`/`buildQueryValidator` to `StandardSchemaV1`; route validation through `standardValidate`. `z.infer<S>` → `StandardSchemaOutput<S>` for the inferred query/body types. **Closes the inconsistency #995 introduced.** The existing router validation tests (`body-validator.test.ts`, `query-validator.test.ts`) must stay green byte-for-byte on error shape.
- **Phase 2 — ai.** Retype `asTool` / `HandoffOptions` / tool input schema to Standard Schema; validate tool inputs through `standardValidate`. Verify against the AI tool test suite.
- **Phase 3 — core (optional / deferred).** Only if pursuing FormRequest; carries the `messages()` wrinkle above. Default: skip, document FormRequest as Zod-coupled.

## Risks / guardrails
- **Error-message parity is load-bearing** — there are tests pinning `ValidationError` shape + messages at each site. Each phase must keep them green; that's the regression gate.
- **Async validate** — `~standard.validate` may return a Promise. All target sites are already async, so `await` is safe; don't introduce sync assumptions.
- **Zod 4 implements `~standard`** — so `z.object(...)` callers are unaffected (a Zod schema satisfies `StandardSchemaV1` structurally); this is type-position only, no app-facing break. Keep it that way (additive, back-compat).
- **Don't big-bang it** — separate PRs per subsystem so a regression is isolated and reviewable.

## Not in scope
- Migrating internal schema construction or mcp's `zodToJsonSchema()`.
- Shipping/recommending a non-Zod validator (Zod stays the default).
- Any runtime behavior change — this is type-position + a validation-funnel swap that preserves error output exactly.
