---
"@rudderjs/orm": minor
---

Per-model named connections (multi-connection PR2): `static connection` + `Model.on('name')`.

A model can bind every query to a named connection with `static connection = 'reporting'` (Laravel's `protected $connection`), or run a one-off query on another connection with `User.on('reporting').where(...)` — `Model.on()` keeps its two-arg lifecycle-listener form (`User.on('creating', fn)`); the one-arg form starts the connection-scoped query. Named connections open lazily on the model's first query via a deferred record-and-replay QueryBuilder: chainables recorded before the open replay onto the real adapter builder at the first terminal — only the first query per connection pays this; afterwards queries build directly on the opened adapter. Queries inside `transaction(fn, { connection })` join that open transaction; observer events, hydration, scopes, and the Model-layer sugar (`whereIn`, `chunk`/`lazy`, …) all work unchanged on named connections.
