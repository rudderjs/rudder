# @rudderjs/contracts

Type-only foundation — interfaces and contracts consumed by all other packages.

Exports: `AppRequest`, `AppResponse`, `RouteHandler`, `QueryBuilder`, `OrmAdapter`, `PaginatedResult`, `ServerAdapter`, `InputTypeError`.

Minimal runtime: `InputTypeError` class + `attachInputAccessors` function (used by server adapters). No dependencies. Change with care — this is the API surface everything builds on.
