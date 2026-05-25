# Your First App

This is a hands-on tour: you'll build a small **link board** — a page that lists saved links and a form to add new ones — in about 30 minutes. By the end you'll have touched the pieces you'll use in every Rudder app: the scaffolder, a model and its table, a controller view, request validation, and the form-submit pattern.

The [What is Rudder?](/guide/) page explains the *why*. This page is the *how*.

## What you'll build

A single page at `/links`:

- A list of links (title + URL), newest first, loaded from the database.
- A form to add a link, validated on the server, that updates the list without a full page reload.

Nothing here is throwaway — it's the same shape as a real feature.

## Prerequisites

- Node.js `^20.19.0` or `>=22.12.0`
- pnpm (or npm/yarn/bun — the scaffolder adapts)

## 1. Scaffold the project

```bash
pnpm create rudder linkboard
```

Pick **Web app** for the recipe, **Prisma** + **SQLite** for the database, **React** for the frontend, and let it install. When it finishes:

```bash
cd linkboard && pnpm dev
```

Open `http://localhost:3000` — you'll see the welcome page. Leave `pnpm dev` running; every change below hot-reloads.

::: tip Non-interactively (CI / agents)
`CLAUDECODE=1 npx create-rudder linkboard --recipe=web-app --db=sqlite --framework=react --install=true` produces the same project with no prompts.
:::

## 2. Define the model and its table

A model is a class that represents one row. Create `app/Models/Link.ts`:

```ts
// app/Models/Link.ts
import { Model } from '@rudderjs/orm'

export class Link extends Model {
  static table    = 'link'              // Prisma client delegate (camelCase of the model name)
  static fillable = ['title', 'url']    // columns mass-assignable from create()/update()

  id!:        string
  title!:     string
  url!:       string
  createdAt!: Date
}
```

`static fillable` is the allowlist of columns a form can set — any other key in the request body is dropped before it reaches the database, so a crafted payload can't write columns you didn't intend.

Now describe the table for Prisma. Add a `Link` model to `prisma/schema/modules.prisma` (the file the scaffolder reserves for your own models):

```prisma
// prisma/schema/modules.prisma
model Link {
  id        String   @id @default(cuid())
  title     String
  url       String
  createdAt DateTime @default(now())
}
```

Sync the schema to your dev database and regenerate the client:

```bash
pnpm rudder db:push
pnpm rudder db:generate
```

::: tip `static table` is the *delegate*, not the SQL table
On Prisma, `static table` is the camelCase client delegate (`link`), not the SQL table name. Getting this wrong surfaces as `Prisma has no delegate for table "..."`.
:::

## 3. Load the list — a controller view

A **controller view** is a route handler that returns a view by id. Open `routes/web.ts` and add the routes below. Your web-app project already defines `const webMw = [CsrfMiddleware()]` near the top — reuse it; if it isn't there, add the import and the line.

```ts
// routes/web.ts
import { Route } from '@rudderjs/router'
import { view } from '@rudderjs/view'
import { CsrfMiddleware } from '@rudderjs/middleware'
import { validate, z } from '@rudderjs/core'
import { Link } from '../app/Models/Link.js'

const webMw = [CsrfMiddleware()]   // already present in a web-app scaffold

// List page
Route.get('/links', async () => {
  const rows  = await Link.query().orderBy('createdAt', 'DESC').get()
  const links = rows.map(l => ({ id: l.id, title: l.title, url: l.url }))
  return view('links', { links })
}, webMw)
```

The view id `'links'` maps to the file `app/Views/Links.tsx` and is served at `/links` — ids map to URLs 1:1 by default.

::: warning Pass plain objects to `view()`, not model instances
Props are serialized for SSR, and a model's prototype methods don't survive that boundary. Map to a plain object (as above) or call `.toJSON()`.
:::

## 4. Build the view

Create `app/Views/Links.tsx`. The form submits with `fetch` and a CSRF token — the same pattern the scaffolded auth views use (see [the CSRF note](#a-note-on-csrf) below):

```tsx
// app/Views/Links.tsx
import { useState } from 'react'
import { navigate } from 'vike/client/router'
import { getCsrfToken } from '@rudderjs/middleware/client'

// Exporting `Props` opts this view into compile-time prop checks —
// the view('links', { links }) call above is now type-checked.
export interface Props {
  links: { id: string; title: string; url: string }[]
}

export default function Links({ links }: Props) {
  const [title, setTitle] = useState('')
  const [url, setUrl]     = useState('')
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const res = await fetch('/links', {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': getCsrfToken(),
      },
      body: JSON.stringify({ title, url }),
    })
    if (res.ok) {
      setTitle(''); setUrl('')
      await navigate('/links')          // re-run the route, refresh the list
    } else {
      const body = await res.json().catch(() => ({})) as { message?: string }
      setError(body.message ?? 'Could not save the link.')
    }
  }

  return (
    <main style={{ maxWidth: 640, margin: '2rem auto', fontFamily: 'system-ui' }}>
      <h1>Link board</h1>
      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8 }}>
        <input value={title} onChange={e => setTitle(e.currentTarget.value)} placeholder="Title" required />
        <input value={url}   onChange={e => setUrl(e.currentTarget.value)}   placeholder="https://…" type="url" required />
        <button type="submit">Add</button>
      </form>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      <ul>
        {links.map(link => (
          <li key={link.id}>
            <a href={link.url} target="_blank" rel="noreferrer">{link.title}</a>
          </li>
        ))}
      </ul>
    </main>
  )
}
```

## 5. Handle the submission — validate and persist

Back in `routes/web.ts`, add the POST handler:

```ts
// routes/web.ts (continued)
Route.post('/links', async (req, res) => {
  const data = await validate(
    z.object({
      title: z.string().min(1).max(120),
      url:   z.string().url(),
    }),
    req,
  )

  const link = await Link.create(data)
  return res.status(201).json({ data: { id: link.id, title: link.title, url: link.url } })
}, webMw)
```

`validate()` merges the request's params, query, and body, parses them against the Zod schema, and returns a fully-typed object. On invalid input it throws `ValidationError`, which the framework renders as a `422` with a structured `{ message, errors }` body — that's the `body.message` the view falls back to. `Link.create(data)` writes the row, respecting `fillable`.

## 6. Try it

With `pnpm dev` running, open `http://localhost:3000/links`, add a link, and watch it appear at the top of the list. Submit an empty title or a non-URL and you'll see the validation message — the server rejected it with a 422 before touching the database.

That's a complete vertical slice: route → validation → model → database → view.

## A note on CSRF

A web-app project protects state-changing requests with `CsrfMiddleware` (that's the `webMw` you reused). Because of it, a plain `<form method="post">` would be rejected — the canonical Rudder pattern is a client `fetch` that sends the token via the `X-CSRF-Token` header, read with `getCsrfToken()` from `@rudderjs/middleware/client`. The middleware issues the token on the GET request and validates it on the POST. The scaffolded `app/Views/Auth/Login.tsx` is the reference implementation — it does exactly this.

## Keep going

Each of these is a small, self-contained next step:

- **A detail page.** Add `Route.get('/links/:link', …)` and resolve the param to a `Link` automatically with [route model binding](/guide/routing#route-model-binding).
- **Named routes.** Chain `.name('links.index')` and generate URLs with `route('links.index')` — see [Routing](/guide/routing#named-routes).
- **Make it the home page.** Add `export const route = '/'` to the top of `Links.tsx` and delete the welcome route.
- **Write a test.** `@rudderjs/testing` can boot the app and assert `GET /links` renders and `POST /links` creates a row — see [Testing](/guide/testing).
- **Move it into a controller.** As the feature grows, group the routes into a class — see [Controllers](/guide/controllers).

## Where to next

- [Routing](/guide/routing) — parameters, groups, named routes, model binding
- [Models](/guide/database/models) — the full query API, relations, scopes, casts
- [Validation](/guide/validation) — form requests, custom rules, error shaping
- [Frontend](/guide/frontend) — controller views vs. Vike pages, layouts, page context
