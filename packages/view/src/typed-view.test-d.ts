/**
 * Type-only test for the typed `view()` overload.
 *
 * Compiled by `pnpm typecheck` (and the test build); failing type assertions
 * surface as tsc errors. This file contains no runtime tests — Node's
 * `--test` glob excludes `*.test-d.js` so the compiled output is ignored at
 * test runtime.
 */
import { view, type ViewPropsRegistry } from './index.js'

// Augmentation simulates what @rudderjs/vite's scanner emits at build time.
declare module './index.js' {
  interface ViewPropsRegistry {
    'typed.demo': { user: { id: number; name: string }; count: number }
  }
}

// Correct shape compiles.
view('typed.demo', { user: { id: 1, name: 'a' }, count: 0 })

// @ts-expect-error count missing
view('typed.demo', { user: { id: 1, name: 'a' } })

// @ts-expect-error count must be number
view('typed.demo', { user: { id: 1, name: 'a' }, count: 'oops' })

// @ts-expect-error 'bogus' is not a key of Props
view('typed.demo', { user: { id: 1, name: 'a' }, count: 0, bogus: true })

// Unknown id falls through to the loose overload — compiles.
view('not-in-registry', { whatever: 1 })

// Dynamic id (string-typed variable) stays on the loose overload — compiles.
const dynamicId: string = 'whatever'
view(dynamicId, { whatever: 1 })

export {}
