---
'@rudderjs/core': patch
---

Three fixes to the `FormRequest` pipeline (`packages/core/src/validation.ts`).

- **`prepareForValidation` now runs before `authorize()` — Laravel parity.** Previously the pipeline was `authorize → prepare → rules`, opposite of Laravel's `FormRequest::validateResolved` order. Subclasses that normalized input for the auth check (e.g., lowering an identifier, parsing a route key into a model) silently saw the unprepared input. Now: `prepare → authorize → rules → after → passed`.

  Soft behavior change — if you previously relied on `prepareForValidation` being skipped when `authorize()` returned false (e.g., to avoid a DB lookup in prepare for unauthorized users), guard the work inside `prepareForValidation` instead. Most subclasses won't notice.

- **`prepareForValidation` is now awaited.** The signature widened from `Record | void` to `Record | void | Promise<Record | void>`; sync overrides keep working. Without the await, a returned Promise passed `typeof === 'object'` and was assigned directly to `input`, then the schema failed with a confusing "Expected object, received object" Zod error. Now async normalization works the same way it does for `passedValidation`.

- **`messages()` override key for top-level errors is `'root'`, matching the rendered error key.** `zodIssuesToErrors` reports path-less issues under `'root'`, but the override map looked them up under `''`. A user reading `errors.root` from the response who wrote `messages() { return { root: 'Custom' } }` got no override; only the literal `''` key worked. Both sides now use `'root'`.

Adds four tests covering each fix: prepare-before-authorize ordering, authorize reading prepare's normalized state, async `prepareForValidation`, and `messages.root` override on a top-level `refine()` issue.
