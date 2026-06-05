# Banner splice: 2s fallback timer fires before the banner on slow dev starts

**Filed by:** pilotiq (downstream), 2026-06-05
**Affects:** `@rudderjs/vite` — `rudderjs:banner` plugin (`src/index.ts` ~310-353)
**Severity:** cosmetic, but visible on every dev start of any non-trivial app

## Symptom

In the pilotiq playground, `pnpm dev` prints the Rudder version as a standalone
line *above* the banner instead of spliced into it:

```
17:47:21 [vite] connected.
  ➜  Rudder v1.7.0                                  ← fallback line
17:47:23 [vite] Re-optimizing dependencies …
  Vike v0.4.259 · Vite v8.0.16 · ready in 3366 ms   ← no Rudder segment
```

The rudder playground (ready in 667 ms) splices correctly:
`Vike v0.4.257 · Vite v8.0.14 · Rudder v1.7.0 · ready in 667 ms`.

## Cause

The `console.log` wrapper installs in `configureServer` and arms a
`setTimeout(…, 2_000)` fallback that prints the standalone line and RESTORES
`console.log`. The comment assumes "the banner prints synchronously right after
`listen()`" — but `configureServer` runs well before listen, and apps with a
heavy `optimizeDeps.include` set (pilotiq pre-bundles tiptap + codemirror +
recharts + ~20 Base UI subpaths) or extra codegen plugins take >2s from
`configureServer` to the banner. The timer wins the race, the wrapper is gone
when the banner finally prints, and the splice never happens. Not a Vike format
change — `spliceRudderVersion` still matches the line when fed it directly.

## Suggested fix

Anchor the fallback to the thing the banner actually follows, not wall-clock
from `configureServer`:

```ts
configureServer(server) {
  …install wrapper…
  const arm = () => setTimeout(fallback, 2_000).unref?.()
  server.httpServer
    ? server.httpServer.once('listening', arm)
    : arm()   // middleware-mode: no http server, keep old behavior
}
```

The banner prints on the next tick after `listening`, so a 2s window from
*there* is generous regardless of how long pre-bundling took. (Alternative:
keep the wrapper installed until the first `ready in`-shaped line OR server
close, no timer at all — slightly stickier but removes the race entirely.)

## Repro

Any app whose `vike dev` reports `ready in` > 2000 ms — e.g.
`pilotiq/playground` after `rm -rf node_modules/.vite && pnpm dev`.
