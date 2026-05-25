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

async function checkTarget(t) {
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
      plugins: [nodeThrowStub],
    })
    out = result.outputFiles[0].text
  } catch (e) {
    const errs = (e.errors || []).map((x) => x.text).slice(0, 6).join('; ')
    return { name: t.name, ok: false, phase: 'bundle', detail: errs || e.message }
  }

  // Evaluate in a sandbox with NO `process` — top-level process.env throws here.
  const sandbox = { module: { exports: {} }, exports: {}, console, globalThis: {} }
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
  process.exit(1)
}
console.log('\nAll client-bundle smoke targets passed.')
