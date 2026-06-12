---
"@rudderjs/http": minor
---

fix(http): pool no longer abandons in-flight requests when one fails

`Pool.send()` rejected the whole batch on the first failed request (`reject(err)` on the first task rejection). That had two problems: the other requests already in flight were abandoned — their work still ran to completion server-side but their results were discarded and could never be awaited — and a single connection error threw away every sibling's successful response.

It now mirrors Laravel's `Http::pool()`: a failed request lands as an `Error` in its own slot, every other request runs to completion, and `send()` never rejects on a request failure. Concurrency limiting is unchanged.

Return type widened from `HttpResponseData[]` to `(HttpResponseData | Error)[]` — narrow each slot before use:

```ts
const results = await Http.pool((p) => {
  p.add((http) => http.get('/a'))
  p.add((http) => http.get('/b'))
}).send()

for (const r of results) {
  if (r instanceof Error) continue // failed request
  console.log(r.status, r.body)
}
```

Previously a returned array was always all-success (any failure threw before returning), so existing runtime code that only read results after a successful batch keeps working; TypeScript callers now narrow the union.
