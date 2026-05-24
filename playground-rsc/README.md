# playground-rsc

**Experimental** RudderJS demo app running on **React Server Components** via
[`vike-react-rsc-rudder`](../packages/vike-react-rsc) (a RudderJS-maintained
fork of nitedani's `vike-react-rsc`), instead of the default
whole-page-hydration `vike-react` renderer.

It is a separate app because the two renderers are **mutually exclusive** — an
app installs exactly one of `vike-react` / `vike-react-rsc-rudder` (the
`@rudderjs/vite` scanner enforces this). `playground/` and `playground-web/` use
`vike-react`; this one uses `vike-react-rsc-rudder`.

## What it demonstrates

- **Server components** — `app/Views/Home.tsx` is an async server component. It
  renders on the server and ships **no** client JS for its own markup.
- **`view()` still works** — a controller (`routes/web.ts`) returns
  `view('home', { greeting })`; the scanner-generated `+Page` reads those props
  via `getPageContext()` and spreads them into the server component. Controller
  props and server-side data-fetching compose.
- **Server actions** — `app/Actions/counter.ts` is `"use server"`; the client
  island `app/Components/CounterClient.tsx` (`"use client"`) calls it directly
  over RSC's RPC, no API route required.

## Run

```bash
pnpm build          # from repo root — compile the framework packages first
cd playground-rsc
pnpm rudder providers:discover   # generate the provider manifest
pnpm dev            # vike dev
```

## Status

Experimental. `vike-react` remains the supported default for RudderJS apps; RSC
support is opt-in and tracks a young community extension. See
`docs/plans/2026-05-23-vike-react-rsc-integration.md`.
