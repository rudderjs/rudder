---
'@rudderjs/core': minor
'@rudderjs/cli': minor
---

Add `FormRequest` lifecycle hooks (Laravel parity #6).

`FormRequest` now supports five optional protected methods that mirror Laravel's lifecycle:

- `prepareForValidation(input)` — mutate merged input pre-parse (sync). Lowercase emails, trim strings, etc.
- `messages()` — per-request error message overrides keyed by dot-path. Static string or `(issue) => string`.
- `after()` — array of cross-field check closures with `addError(path, msg)`. Run serially after parse; all errors collected in one round-trip.
- `passedValidation(data)` — final transform on parsed data (sync or async); return value replaces resolved data.
- `failedValidation(errors)` — override the throw. Default throws `ValidationError`; return a Web `Response` to short-circuit (wrapped in a new `ValidationResponse` sentinel that the framework's exception handler unwraps).

Existing `FormRequest` subclasses keep working unchanged — the hooks have empty default implementations.

The `make:request` stub now includes commented-out hook signatures to aid discovery.