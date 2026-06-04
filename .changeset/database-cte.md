---
"@rudderjs/database": minor
"@rudderjs/orm": minor
---

feat: common table expressions on the native engine — `withExpression(name, query, opts?)` / `withRecursiveExpression(...)` on query chains and as `Model` statics. The body is another native query (`Model.query()` chain) or a raw SQL string with `?` placeholders + `opts.bindings` (recursive bodies are usually raw — they reference the CTE's own name); `opts.columns` emits the explicit column list. Compiles to a `WITH [RECURSIVE] …` prefix on reads (`get`/`first`/`find`/`count`/`paginate`) with CTE bindings first (SQL text order); reference the CTE via `join('name', …)`. Native engine only — Drizzle/Prisma throw the forward-or-throw guard error.
