# @rudderjs/contracts

Type-only foundation — interfaces and contracts consumed by all other packages.

Exports: `AppRequest`, `AppResponse`, `RouteHandler`, `QueryBuilder`, `OrmAdapter`, `PaginatedResult`, `ServerAdapter`, `InputTypeError`, plus the DB execution contracts `Row` / `Executor` / `Transaction` / `Connection` (re-exported by `@rudderjs/database` as the `DB`-facade seam; `OrmAdapter.selectRaw?` / `affectingStatement?` are the raw-exec hooks the facade calls).

Minimal runtime: `InputTypeError` class + `attachInputAccessors` function (used by server adapters). No dependencies. Change with care — this is the API surface everything builds on.
