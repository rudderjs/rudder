# @rudderjs/contracts

Type-only foundation — interfaces and contracts consumed by all other packages.

Exports: `AppRequest`, `AppResponse`, `RouteHandler`, `QueryBuilder`, `OrmAdapter`, `PaginatedResult`, `ServerAdapter`, `InputTypeError`, plus the DB execution contracts `Row` / `Executor` / `Transaction` / `Connection` (re-exported by `@rudderjs/database` as the `DB`-facade seam; `OrmAdapter.selectRaw?` / `affectingStatement?` are the raw-exec hooks the facade calls, `OrmAdapter.onQuery?` + `QueryEvent` / `QueryListener` the query-listening hook behind `DB.listen()`).

Minimal runtime: `InputTypeError` class + `attachInputAccessors` function (used by server adapters), and the **Standard Schema funnel** `standardValidate(schema, value)` / `standardIssuesToErrors(issues)` + the `StandardSchemaV1` / `StandardSchemaIssue` / `StandardSchemaOutput` types (the validator-agnostic interface the router's `.body()`/`.query()`/`.responds()` boundary types against — Zod 4 / Valibot / ArkType all implement `~standard`; Zod is the default). `standardValidate` normalizes `~standard.validate()` (possibly async) into a success value or the `{ [path]: string[] }` `ValidationError` error map. `StandardSchemaV1` is inlined to keep the no-dep invariant — swap to `@standard-schema/spec` later without a code change. No dependencies. Change with care — this is the API surface everything builds on.
