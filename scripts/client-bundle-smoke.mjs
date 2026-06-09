// Client-bundle smoke gate.
//
// Several @rudderjs/* packages are legitimately bundled into the BROWSER by
// consumers (e.g. a `Model` reachable from client code, or `app`/`Env` imported
// from a client-reachable module). Those entries must evaluate in a browser
// without pulling Node: no top-level `process.env` read, no *static* `node:`
// import in the eval graph.
//
// This catches two distinct, real regressions:
//   1. top-level `process.env` access (orm 1.12.4: `process is not defined`)
//   2. a static top-level `node:` import dragged in transitively (@clack via a
//      console re-export — what makes @rudderjs/core's main entry client-hostile)
//
// It deliberately TOLERATES lazy `await import('node:x')` inside functions —
// that's the correct pattern (it never runs at module eval). We model that by
// stubbing every `node:` specifier with a module that THROWS at eval: a static
// import triggers the throw (caught), a lazy import defers it (tolerated).
//
// Then we evaluate the bundle in a `vm` sandbox with NO `process` global, so a
// top-level `process.env` read throws `process is not defined`.
//
// ── Two target modes ──────────────────────────────────────────────────────
//
// `strict` (the above): the entry must not even LOAD a `node:` builtin at
// module eval. For entries that are fully client-safe by contract.
//
// `vite-dev`: models how Vite actually serves a *Node-only-by-design* main
// entry that client code reaches transitively (core 1.11 regression, pilotiq
// e2e 23/23 red). Vite's optimizeDeps pre-bundles the WHOLE entry (every
// export is a live root — `sideEffects` can't drop anything) and rewrites
// `node:*` to browser-external stubs that throw **on property access**, not on
// load. So static `import path from 'node:path'` chains (e.g. @clack via the
// console re-export) evaluate harmlessly — but a module-top-level `path.join`
// crashes the SPA before hydration. core@1.11's maintenance.js did exactly
// that and this gate stayed green; the `vite-dev` mode exists to catch the
// next one. Invariant enforced: every `node:*` *call* must live inside a
// function body, never at module top level.

import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import vm from 'node:vm'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// Resolve targets from a real consumer: pnpm links workspace packages into each
// consumer's node_modules, not the repo root. `playground` depends on the full
// @rudderjs/* surface, so resolving here also exercises each package's exports map.
const resolveDir = resolve(repoRoot, 'playground')

// Entries consumers legitimately reach from client code. We `export * from` each
// so EVERY export is a live root — modeling Vite's optimizeDeps, which pre-bundles
// the whole entry. (A selective `import { x }` would let esbuild elide unused
// re-exports and hide a hostile re-exported module like the @clack chain.)
const TARGETS = [
  { name: '@rudderjs/orm', code: `export * from '@rudderjs/orm'` },
  { name: '@rudderjs/core/client', code: `export * from '@rudderjs/core/client'` },
  // The rest are entries that views / client code already import (audited green
  // 2026-05-26). Listed here so a future regression in any of them is caught,
  // not just orm/core.
  { name: '@rudderjs/view', code: `export * from '@rudderjs/view'` },
  { name: '@rudderjs/router', code: `export * from '@rudderjs/router'` },
  { name: '@rudderjs/support', code: `export * from '@rudderjs/support'` },
  { name: '@rudderjs/ai', code: `export * from '@rudderjs/ai'` },
  { name: '@rudderjs/middleware/client', code: `export * from '@rudderjs/middleware/client'` },
  // Node-only-by-design main entries that client code still reaches
  // transitively (localization, app service providers, …). They may LOAD
  // `node:` builtins at eval (the @clack chain), but must never CALL one at
  // module top level — see the `vite-dev` mode rationale up top.
  { name: '@rudderjs/core (vite-dev)', code: `export * from '@rudderjs/core'`, mode: 'vite-dev' },
]

// esbuild plugin: route every `node:` builtin to a module that throws at eval.
const nodeThrowStub = {
  name: 'node-throw-stub',
  setup(b) {
    b.onResolve({ filter: /^node:/ }, (args) => ({ path: args.path, namespace: 'node-throw' }))
    b.onLoad({ filter: /.*/, namespace: 'node-throw' }, (args) => ({
      contents: `throw new Error(${JSON.stringify(`client bundle eval-loaded a Node builtin (${args.path})`)});`,
    }))
  },
}

// esbuild plugin for `vite-dev` mode: a faithful model of Vite's
// `__vite-browser-external` — the stub LOADS fine, but any property access
// throws ("Cannot access node:path.join in client code"). Authored as CJS so
// esbuild's interop defers named-import accesses to the use site (exactly like
// Vite dev / optimizeDeps); module-namespace plumbing keys (`__esModule`,
// symbols) are let through so the interop itself doesn't false-positive.
const nodeAccessStub = {
  name: 'node-access-stub',
  setup(b) {
    b.onResolve({ filter: /^node:/ }, (args) => ({ path: args.path, namespace: 'node-access' }))
    b.onLoad({ filter: /.*/, namespace: 'node-access' }, (args) => ({
      contents: `
        module.exports = new Proxy({}, {
          get(_, p) {
            if (p === '__esModule') return false
            if (typeof p === 'symbol' || p === 'then') return undefined
            throw new Error(${JSON.stringify(`module-top-level Node builtin access (${args.path}.`)} + String(p) + ') in client code')
          },
        })
      `,
    }))
  },
}

async function checkTarget(t) {
  const viteDev = t.mode === 'vite-dev'
  let out
  try {
    const result = await build({
      stdin: { contents: t.code, resolveDir, loader: 'js' },
      bundle: true,
      platform: 'browser',
      format: 'cjs',
      write: false,
      logLevel: 'silent',
      // Disable tree-shaking so a hostile *re-exported* module (e.g. the @clack
      // chain via a console re-export) isn't silently dropped just because the
      // sample only names client-safe symbols. This models Vite's optimizeDeps,
      // which pre-bundles the whole entry (the package marks index.js with
      // `sideEffects`) — the scenario that actually bit consumers.
      treeShaking: false,
      // Vite always defines NODE_ENV when pre-bundling; mirror it in vite-dev
      // mode so NODE_ENV-gated guards behave as they do in a real app.
      ...(viteDev ? { define: { 'process.env.NODE_ENV': '"development"' } } : {}),
      plugins: [viteDev ? nodeAccessStub : nodeThrowStub],
    })
    out = result.outputFiles[0].text
  } catch (e) {
    const errs = (e.errors || []).map((x) => x.text).slice(0, 6).join('; ')
    return { name: t.name, ok: false, phase: 'bundle', detail: errs || e.message }
  }

  // Evaluate in a sandbox with NO `process` — top-level process.env throws here.
  const module = { exports: {} }
  const sandbox = { module, exports: module.exports, console, globalThis: {} }
  sandbox.globalThis = sandbox
  try {
    vm.runInNewContext(out, sandbox, { timeout: 5000 })
  } catch (e) {
    return { name: t.name, ok: false, phase: 'eval', detail: e.message }
  }
  return { name: t.name, ok: true }
}

const results = []
for (const t of TARGETS) results.push(await checkTarget(t))

let failed = false
for (const r of results) {
  if (r.ok) {
    console.log(`✓ ${r.name} — client-safe (evaluates in browser, no Node at eval)`)
  } else {
    failed = true
    console.error(`✘ ${r.name} — ${r.phase} failure: ${r.detail}`)
  }
}

if (failed) {
  console.error('\nClient-bundle smoke gate FAILED. A client-reachable entry pulls Node at module eval.')
  console.error('Fix: guard top-level `process` reads with `typeof process !== "undefined"`, and keep')
  console.error('static `node:` imports / CLI (@clack) chains out of the entry (lazy `await import` is fine).')
  console.error('For a `vite-dev` target (Node-only main entry): the static `node:` import is fine, but the')
  console.error('CALL must move inside a function — no `path.join(...)`/`fs.*(...)` at module top level')
  console.error('(core@1.11 maintenance.js regression: crashed every consumer SPA before hydration).')
  process.exit(1)
}
console.log('\nAll client-bundle smoke targets passed.')
