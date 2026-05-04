# `@rudderjs/core` — `FormRequest` Lifecycle Hooks

**Status:** PROPOSED — design + implementation contract.
**Author handoff:** filed for the next rudder agent. Self-contained.
**Scope:** v1 = `prepareForValidation` + `passedValidation` + `after` + `failedValidation` + `messages`. Named error bags + Precognition deferred.

---

## Why

`FormRequest` today (`packages/core/src/validation.ts:22`) is the bare minimum: `rules()` + `authorize()` + `validate(req)`. Laravel apps lean on the lifecycle hooks as much as on `rules()` — trim/lowercase before parsing, cross-field checks after, message overrides per request, custom failure responses. Without them, every controller re-implements the same mutate-input + re-validate dance, and the Zod-only path forces awkward `.transform()` + `.refine()` schemas where Laravel devs reach for one-line hooks.

This plan adds the four lifecycle hooks plus `messages()` while keeping the existing API untouched: every existing `FormRequest` subclass keeps working with no changes.

---

## Current shape (recap)

`packages/core/src/validation.ts:22` — `abstract rules(): T`, `authorize(): boolean`, `validate(req): Promise<z.infer<T>>`. `validate()` merges `body+query+params`, calls `rules().parse(input)`, converts `ZodError.issues` to `Record<string, string[]>` (dot-paths, top-level → `'root'`), throws `ValidationError`.

Things that survive: `T extends ZodType`, `protected req`, `abstract rules()`, `authorize()`, `validate(req)` signature + return type. The body of `validate()` is the only thing that changes.

---

## Order of operations (v2)

```
validate(req)
  ├─ assign this.req
  ├─ authorize()                              → throws ValidationError({ auth: [...] })
  ├─ build merged input  (body + query + params)
  ├─ prepareForValidation(input)              → returns mutated input (or void = mutate-in-place)
  ├─ schema = rules()
  ├─ messages = messages()                    → optional Record<path, string|fn>; converted to Zod error map
  ├─ schema.safeParse(input, { errorMap })
  │     ├─ failure → failedValidation(errors) → throws (default: ValidationError)
  │     └─ success → data = result.data
  ├─ run after():
  │     for fn of after():
  │       fn({ data, addError, req })        — sync OR async, awaited serially
  │     if any addError() called → failedValidation(errors)
  ├─ passedValidation(data)                   → returns data (or void = identity)
  └─ return data
```

Two failure points: Zod parse fail and `after()` errors. Both converge through `failedValidation(errors)` so users have one override hook.

---

## API additions

### 1. `prepareForValidation(input)`

Runs **before** `rules()` is called. Mutate in place or return a new object.

```ts
protected prepareForValidation(input: Record<string, unknown>): Record<string, unknown> | void {
  // default: no-op
}
```

- **Signature**: takes the merged `body+query+params` Record. Returns `Record | void`. If returns a Record, that replaces the input fed to the schema; if returns `void`, the (mutated) argument is used.
- **Sync only.** Same as Laravel — keeps the lifecycle predictable. If users need async prep, they should pre-await before calling `validate()`.
- **Order**: before `rules()` is called, so `rules()` can read `this.req` *and* the prepared values aren't visible there (rules sees the schema definition only — input flows in at `parse()`).

```ts
class StoreUser extends FormRequest {
  override prepareForValidation(input: Record<string, unknown>) {
    if (typeof input['email'] === 'string') input['email'] = input['email'].toLowerCase().trim()
    if (typeof input['name']  === 'string') input['name']  = input['name'].trim()
  }
  rules() { return z.object({ email: z.string().email(), name: z.string().min(2) }) }
}
```

### 2. `passedValidation(data)`

Runs **after** successful parse + after `after()` callbacks pass. Receives the **typed** parsed data.

```ts
protected passedValidation(data: z.infer<T>): z.infer<T> | void | Promise<z.infer<T> | void> {
  // default: no-op
}
```

- Sync **or** async (awaited). Async because users will write to DB / hit cache here.
- Return value: a Record replaces what `validate()` resolves to; `void` keeps the parsed data.
- Common use: hash a password, attach derived fields, log a "validated" event.

```ts
class StoreUser extends FormRequest {
  rules() { return z.object({ email: z.string().email(), password: z.string().min(8) }) }
  override async passedValidation(data) {
    return { ...data, password: await Bcrypt.hash(data.password) }
  }
}
```

### 3. `after()` — extra checks against parsed data

```ts
type AfterCallback<TData> = (ctx: AfterContext<TData>) => void | Promise<void>

interface AfterContext<TData> {
  data:     TData
  req:      AppRequest
  addError: (path: string, message: string) => void
}

protected after(): Array<AfterCallback<z.infer<T>>> {
  return []
}
```

- Returns an **array of closures**. Each is called with `{ data, req, addError }`.
- Closures can be sync or async. Awaited **serially** (matches Laravel's `Validator::after()` semantics: order is intentional).
- `addError(path, message)` mirrors Laravel's `$validator->errors()->add(field, msg)`. Same key shape as the rest of `ValidationError.errors` (dot-paths, top-level → `'root'`).
- All `after()` callbacks run **even if** an earlier one called `addError()`. Users get the full set of cross-field errors in one round-trip, same as Laravel.
- If any `addError()` was called during the loop, `failedValidation(allErrors)` fires.

```ts
class TransferRequest extends FormRequest {
  rules() {
    return z.object({
      from:   z.string(),
      to:     z.string(),
      amount: z.number().positive(),
    })
  }
  override after() {
    return [
      ({ data, addError }) => {
        if (data.from === data.to) addError('to', 'Cannot transfer to the same account')
      },
      async ({ data, addError, req }) => {
        const acct = await Account.find(data.from)
        if (!acct || acct.userId !== req.user?.id) addError('from', 'Account not found')
        else if (acct.balance < data.amount) addError('amount', 'Insufficient funds')
      },
    ]
  }
}
```

**Why an array of closures (not method strings):** Laravel takes either; we're TypeScript-first. A bare array of closures is fully typed (each closure sees the inferred `z.infer<T>`), no string-key lookup, no class-method discovery cost, no late-bound `this`. Users who want methods can do `[this.checkFunds.bind(this)]` — no need to special-case.

### 4. `failedValidation(errors)`

```ts
protected failedValidation(errors: Record<string, string[]>): never | Response | Promise<never | Response> {
  throw new ValidationError(errors)
}
```

- Default behavior unchanged: throws `ValidationError`.
- Users can `throw` a different exception (e.g. a JSON-shaped `HttpException`).
- Users can **return a `Response`** (Web `Response`) for a short-circuited reply. `validate()` will detect the return and re-throw it as a sentinel that the framework's exception layer unwraps to send the response directly. (Mirrors how view-controller route handlers already short-circuit with raw `Response` objects in server-hono.)
- Sync or async return permitted; awaited.

**Sentinel choice**: introduce `class ValidationResponse extends Error { constructor(public response: Response) {...} }` — a controlled escape hatch that `server-hono`'s normalizer picks up and unwraps. Cheaper than threading a return-value through `validate()`'s public signature (which today resolves to `z.infer<T>`).

### 5. `messages()` — per-request error message overrides

Laravel's `messages()` returns a map of `'field.rule' => 'Message'`. Zod has no rule names — its `errorMap` callback receives an `issue` object with `code`, `path`, etc.

Proposed rudder shape — a path-keyed map:

```ts
protected messages(): Record<string, string | ((issue: z.core.$ZodIssue) => string)> {
  return {}
}
```

- Key = dot-path of the field (`'email'`, `'address.city'`). Value = static string OR function `(issue) => string`.
- Merged into a Zod `errorMap` passed at `safeParse(input, { error: customMap })` (Zod v4 syntax — confirmed via `packages/core/package.json` `"zod": "^4.0.0"`).
- Lookup order: exact path match → no match → fall through to Zod default (existing behavior).
- Function form gives access to issue code/expected/received for users who want one custom message branched by code.

```ts
class StoreUser extends FormRequest {
  rules() {
    return z.object({ email: z.string().email(), age: z.number().int().min(18) })
  }
  override messages() {
    return {
      'email': 'Please enter a valid email address.',
      'age':   (issue) => issue.code === 'too_small'
        ? 'You must be at least 18 to register.'
        : 'Age must be a whole number.',
    }
  }
}
```

**Interaction with Zod's own `.message()`**: Zod-provided messages (e.g. `z.string().email('bad email')`) take precedence over the schema's default text. The error map fires only when the schema didn't supply a custom message — same as Zod v4's documented `errorMap` precedence. So `messages()` is a *fallback*, not an override of explicitly-set Zod messages. Document this as intentional: Laravel users get the per-request override they want; Zod users keep the schema-local control they expect.

---

## Type safety

`prepareForValidation` sees raw `Record<string, unknown>` (pre-parse, untyped). `after()` ctx.data and `passedValidation` data are both `z.infer<T>` — typed automatically thanks to the existing class-level generic. No second generic parameter needed. `validate()` resolves to `z.infer<T>` (or whatever `passedValidation` returns).

---

## Backwards compatibility

Existing `FormRequest` subclasses override `rules()` (required) and optionally `authorize()`. Both stay verbatim. The new hooks have empty-default implementations on the base class. Nothing in the existing test suite (`packages/core/src/validation.test.ts:206-280`) needs to change.

The `validate()` public signature stays `(req: AppRequest) => Promise<z.infer<T>>`. The body changes, but no caller breaks.

The freestanding `validate(schema, req)` and `validateWith(schema)` helpers are **unchanged** — they exist for users who don't want a class. Hooks are class-only.

---

## Implementation tasks

### Task 1 — Refactor `validate()` body

In `packages/core/src/validation.ts`:

1. Add the five protected default methods to `FormRequest` (empty defaults).
2. Add a `ValidationResponse extends Error` class for the `failedValidation` short-circuit (single field `response: Response`).
3. Rewrite `validate()` to walk the Order of Operations table above. Sketch:

```ts
async validate(req: AppRequest): Promise<z.infer<T>> {
  this.req = req
  if (!this.authorize()) return this.fail({ auth: ['Unauthorized'] })

  let input = this.mergedInput(req)
  const prepared = this.prepareForValidation(input)
  if (prepared && typeof prepared === 'object') input = prepared

  const errorMap = this.buildErrorMap()
  const result = errorMap
    ? this.rules().safeParse(input, { error: errorMap })
    : this.rules().safeParse(input)
  if (!result.success) return this.fail(this.zodToErrors(result.error))

  const data = result.data as z.infer<T>
  const errors: Record<string, string[]> = {}
  const addError = (path: string, msg: string) => {
    errors[path] = [...(errors[path] ?? []), msg]
  }
  for (const cb of this.after()) await cb({ data, req, addError })
  if (Object.keys(errors).length > 0) return this.fail(errors)

  const post = await this.passedValidation(data)
  return (post && typeof post === 'object' ? post : data) as z.infer<T>
}

private async fail(errors: Record<string, string[]>): Promise<never> {
  const out = await this.failedValidation(errors)
  if (out instanceof Response) throw new ValidationResponse(out)
  throw new ValidationError(errors)
}
```

`buildErrorMap()` returns `undefined` when `messages()` is empty (skip the `error` option entirely so Zod's defaults stay clean). When non-empty, it's a `(issue) => { message } | undefined` that looks up `issue.path.join('.')` in the messages map. `zodToErrors()` is the existing 6-line ZodError → Record converter, extracted from today's `validate()` body.

### Task 2 — Server-hono `ValidationResponse` unwrap

In `packages/server-hono/src/...` (find the existing `ValidationError`-handling branch in the response normalizer): add a parallel branch for `ValidationResponse` that pulls `.response` and emits it directly. ~5 lines. The existing exception layer already has the entry point; this is one more `instanceof` check.

### Task 3 — Re-export `ValidationResponse`

Add to `packages/core/src/index.ts:43`:

```ts
export { FormRequest, ValidationError, ValidationResponse, validate, validateWith, z } from './validation.js'
```

### Task 4 — Tests

Add to `packages/core/src/validation.test.ts` under the existing `describe('FormRequest', ...)` block. Mirror the existing test style (in-file class definitions, `assert.deepStrictEqual` on resolved data).

| Scenario | Assert |
|---|---|
| `prepareForValidation` mutates input in place | parsed data reflects the mutation (e.g. lowercased email) |
| `prepareForValidation` returns new object | parsed data uses returned object, not original |
| `prepareForValidation` returning `void` keeps mutated arg | mutation visible |
| `passedValidation` returning a Record replaces resolved data | resolved value === returned object |
| `passedValidation` returning `void` returns parsed data | resolved === parsed |
| `passedValidation` async path | awaited |
| `after()` with no errors | resolves normally |
| `after()` adding one error | throws `ValidationError` with that field |
| `after()` adding multiple errors across callbacks | all errors collected (one round-trip) |
| `after()` async callback | awaited; errors collected |
| `failedValidation` overridden to throw custom error | custom error propagates |
| `failedValidation` returning a `Response` | throws `ValidationResponse` wrapping it |
| `messages()` static string match by path | Zod issue uses overridden message |
| `messages()` function match by path | function called, message used |
| `messages()` no entry for a path | falls through to Zod default |
| `messages()` doesn't override schema-supplied `.message()` | (precedence test) |
| existing `rules() + authorize()` only subclass | still works (regression) |
| `prepareForValidation` runs *before* `rules()` is called | use a counter / flag inside both methods |
| order: `prepareForValidation → parse → after → passedValidation` | counter |

### Task 5 — Update the `make:request` stub

`packages/cli/src/commands/make/request.ts:5` — extend the generated stub with **commented-out** hook signatures (one each: `prepareForValidation`, `messages`, `after`, `passedValidation`) so users discover them. `packages/cli/src/index.test.ts:136` asserts only the class declaration line — no test touch needed.

### Task 6 — Docs

- `packages/core/README.md` — extend the FormRequest section with a hooks subsection. Use the `StoreUser` + `TransferRequest` snippets from this plan as canonical examples.
- `packages/core/boost/guidelines.md:124` — extend the FormRequest paragraph with a one-liner on the lifecycle hooks. Cross-check against `src/index.ts` exports per the boost-guidelines pitfall in MEMORY.md.
- `packages/core/CHANGELOG.md` — minor bump entry. Additive; no consumer migration.
- `packages/core/CLAUDE.md:11` — extend the validation bullet to mention the lifecycle hooks.
- After the framework PR merges, run the rudderjs-com docs sync per the standard 4-step sweep.

### Task 7 — Cut a changeset

`pnpm changeset` — minor bump for `@rudderjs/core` (additive). Also bumps `@rudderjs/server-hono` if Task 2's unwrap branch lands together.

---

## Out of scope

- **Named error bags** (`errors()->errorBag('register')`) — trivial to add later via `bag?: string` constructor arg on `ValidationError`.
- **Precognition / live validation** — larger surface (route opt-in + request flag + response shape). Future plan.
- **`stopOnFirstFailure`** — Zod's parse already short-circuits per-field; `after()` is explicitly run-all to collect cross-field errors.
- **Method strings in `after()`** (Laravel's `["Class@method"]`) — closures cover the case, fully typed.
- **Async `prepareForValidation`** — sync matches Laravel + avoids an awkward async boundary right before `parse()`.

---

## Open questions for the implementer

1. **`Response` short-circuit unwrap location** — confirm `server-hono`'s exception-handling branch (search for the existing `ValidationError` catch as the reference). Per memory's `feedback_set_cookie_collapse.md`, don't `new Response(body, { headers })` the unwrapped response — emit it directly.
2. **`after()` mutation of `data`** — Laravel allows it; we should too. Document that mutating `data` mutates what `passedValidation` and the controller receive (don't mark `readonly`).
3. **`messages()` for nested array indices** — `'items.0.name'` works via Zod path joins. Document; no special handling.

---

## File touch list (final)

- `packages/core/src/validation.ts` — hook methods + rewritten `validate()` body + `ValidationResponse` class
- `packages/core/src/validation.test.ts` — extend `describe('FormRequest', ...)` with hook tests
- `packages/core/src/index.ts` — re-export `ValidationResponse`
- `packages/server-hono/src/...` — `ValidationResponse` unwrap branch (one `instanceof` check)
- `packages/cli/src/commands/make/request.ts` — extend stub with commented hooks
- `packages/core/README.md` — hooks subsection
- `packages/core/boost/guidelines.md` — one-liner update
- `packages/core/CHANGELOG.md` — minor entry
- `packages/core/CLAUDE.md` — validation bullet update
- `.changeset/<random>.md` — generated by `pnpm changeset`

Estimated: half a day for impl + tests + docs. The hooks are mechanical; the only fiddly bit is the server-hono unwrap branch.
