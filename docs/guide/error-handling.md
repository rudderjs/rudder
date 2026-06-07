# Error Handling

When something goes wrong, Rudder catches the error, decides whether to render it (404 page, JSON error) or report it (log, error tracker), and returns a response. You configure the policy in `bootstrap/app.ts`; you trigger it from your code by throwing an exception or calling `abort()`.

## Throwing an HTTP error

The most common pattern: throw `HttpException` (or use the `abort()` helper) when you want to short-circuit the request with a specific status:

```ts
import { abort, abort_if, abort_unless } from '@rudderjs/core'

// Throw a 404
router.get('/api/users/:id', async (req, res) => {
  const user = await User.find(req.params.id)
  if (!user) abort(404, 'User not found')
  return res.json({ data: user })
})

// Conditional helpers
abort_if(req.user?.role !== 'admin', 403, 'Admins only')
abort_unless(post.authorId === req.user.id, 403)
```

`abort(status, message?, headers?)` throws `HttpException`. The framework catches it and renders an appropriate response — JSON for API requests, HTML for browser navigations.

```ts
import { HttpException } from '@rudderjs/core'

throw new HttpException(429, 'Too many requests', { 'Retry-After': '60' })
```

## Reporting an error

`report(err)` sends an exception to the configured reporter (Sentry, log file, console — whatever's wired up) without short-circuiting the request. Use it for non-fatal errors you want to know about:

```ts
import { report, report_if } from '@rudderjs/core'

try {
  await sendWelcomeEmail(user)
} catch (err) {
  report(err)        // log it but keep going
}

report_if(payment.amount < 0, new Error('Negative payment amount'))
```

The default reporter writes to `console.error`. Installing `@rudderjs/log` automatically wires the reporter to the configured log channel.

## Configuring exception handling

`bootstrap/app.ts` exposes `.withExceptions(...)` for custom renderers, ignored types, and the report destination:

```ts
import { Application, HttpException } from '@rudderjs/core'
import * as Sentry from '@sentry/node'

export default Application.configure({ /* ... */ })
  .withExceptions((e) => {
    // Custom renderer for a domain error
    e.render(PaymentError, (err, req) =>
      Response.json({ code: err.code, message: err.message }, { status: 402 }),
    )

    // Re-throw a class so the framework's default handling skips it
    e.ignore(KnownIgnorableError)

    // Override the reporter
    e.reportUsing((err) => Sentry.captureException(err))
  })
  .create()
```

The pipeline runs in this order:

1. **Ignored types** are re-thrown — the host process or platform handles them.
2. **User renderers** registered via `e.render(Type, fn)` take priority.
3. **`ValidationError`** renders as 422 JSON with `{ message, errors }`.
4. **`HttpException`** renders with its status code (JSON for API requests, HTML for browser navigations).
5. **Duck-typed `httpStatus`** — any `Error` with a numeric `httpStatus` property in the 4xx/5xx range renders with that status. This is how adapter-owned errors flow through without a hard dependency on `@rudderjs/core`: `MalformedBodyError` (from `@rudderjs/contracts`, raised by `@rudderjs/server-hono` on malformed JSON / form-urlencoded request bodies → 400), `ModelNotFoundError` (`@rudderjs/orm` → 404), `RouteModelNotFoundError` (`@rudderjs/router` → 404). Custom errors can opt in by declaring `readonly httpStatus = <number>` on the class.
6. **Anything else** is reported and rendered as 500 (HTML stack trace if `APP_DEBUG=true`, generic page otherwise).

## Scaffolding a custom exception

`make:exception` writes a domain exception class to `app/Exceptions/` with the `httpStatus` opt-in baked in:

```bash
pnpm rudder make:exception PaymentRequiredError --status 402
# → app/Exceptions/PaymentRequiredError.ts
```

`--status` takes any 4xx/5xx code (default `500`). Thrown from a route, the exception renders with that status through pipeline step 5 — no `e.render()` registration needed unless you want a custom response shape.

## Dev error page

In development (`APP_ENV=local|development`, with `APP_DEBUG` on / outside production), uncaught errors render an Ignition-style HTML page with the message, parsed stack trace, source-code context around the throw, and the request envelope. The page is browser-rendered for HTML requests; JSON requests still get a structured error response.

The **stack frames are clickable** — click any frame's `file:line` and your editor jumps to that location. The URL scheme is picked by the `APP_EDITOR` env var:

| `APP_EDITOR` | URL scheme |
|---|---|
| `vscode` (default) | `vscode://file/<path>:<line>` |
| `cursor` | `cursor://file/<path>:<line>` |
| `webstorm` | `webstorm://open?file=<path>&line=<line>` |
| `phpstorm` | `phpstorm://open?file=<path>&line=<line>` |
| `idea` | `idea://open?file=<path>&line=<line>` (JetBrains family) |
| `sublime` | `subl://open?url=file://<path>&line=<line>` |
| `atom` | `atom://core/open/file?filename=<path>&line=<line>` |
| `none` | Plain text (no anchor wrapping) |

```bash
# .env
APP_EDITOR=cursor
```

Unknown values fall back to `vscode` with a single dev-time warning. Windows paths are forward-slashed automatically before being embedded in the URL.

Above the stack, a **Copy as Markdown** button captures the whole error context (message, location, source window, parsed stack, request envelope) as a single Markdown blob suitable for pasting into Claude/Cursor/GPT.

## Custom error pages

The framework's default 4xx and 5xx pages are reasonable, but for branded experiences add a Vike error page at `pages/_error/+Page.tsx`:

```tsx
import { usePageContext } from 'vike-react/usePageContext'

export default function ErrorPage() {
  const { abortStatusCode, abortReason } = usePageContext()

  if (abortStatusCode === 404) return <h1>Page not found</h1>
  if (abortStatusCode === 401) return <h1>{String(abortReason ?? 'Unauthorized')}</h1>
  return <h1>Something went wrong</h1>
}
```

`HttpException` thrown from a route renders through this page when the request expects HTML. JSON requests get a JSON response with the matching status.

## Validation errors

`ValidationError` (thrown by `validate()` / `FormRequest`) is a special case — the default handler renders a 422 with a structured `{ message, errors }` body. You don't need a custom renderer unless your API uses a different error shape:

```ts
e.render(ValidationError, (err) =>
  Response.json({ ok: false, fieldErrors: err.errors }, { status: 422 }),
)
```

See [Validation](/guide/validation) for the schema side.

## Reporting destinations

Common reporter wirings:

```ts
// Sentry
e.reportUsing((err) => Sentry.captureException(err))

// Datadog / Honeycomb / your tracer
e.reportUsing((err) => tracer.recordException(err))

// Multiple destinations
e.reportUsing((err) => {
  console.error(err)
  Sentry.captureException(err)
})
```

`@rudderjs/log` calls `setExceptionReporter(...)` on its own when its provider boots, so unhandled exceptions automatically flow into your configured log channels. You only need `e.reportUsing(...)` when you want to override that or add an additional sink.

## API reference

| Export | Description |
|---|---|
| `HttpException` | Error subclass with `statusCode`, `message`, optional `headers` |
| `abort(status, message?, headers?)` | Throws `HttpException` |
| `abort_if(cond, status, …)` | Throws if `cond` is truthy |
| `abort_unless(cond, status, …)` | Throws if `cond` is falsy |
| `report(err)` | Send to the configured reporter; doesn't throw |
| `report_if(cond, err)` | Conditional `report()` |
| `setExceptionReporter(fn)` | Override the global reporter (called by `@rudderjs/log`) |

## Pitfalls

- **Catching `HttpException` accidentally.** A `try { ... } catch (err) {}` around an `abort()` call swallows the exception and the framework never sees it. Re-throw if you don't intend to handle it.
- **`reportUsing` not firing.** The reporter is only called for **unhandled** errors. Errors caught by your renderer chain are not auto-reported — call `report(err)` inside the renderer if you want both.
- **`APP_DEBUG=true` in production.** Stack traces leak path and dependency information. Keep debug mode off outside development.
