/**
 * Vike module augmentation — declares `pageContext.viewHeaders`,
 * populated by `ViewResponse.toResponse()` and consumed by
 * `@rudderjs/vite`'s `+headersResponse` hook.
 *
 * `pageContext.viewProps` is also forwarded (set by the same renderPage()
 * call) and exposed here for consuming view components.
 */

import type { ViewProps, ViewPropsRegistry } from '../index.js'

declare global {
  namespace Vike {
    interface PageContext {
      /**
       * Props passed to the view component, set by `view('id', props)`.
       *
       * Typed as the union of all registered prop shapes when at least one
       * view has augmented `ViewPropsRegistry` (via the scanner-emitted
       * `pages/__view/registry.d.ts`); falls back to `ViewProps` (loose
       * record) for apps that haven't adopted the typed convention.
       */
      viewProps?: keyof ViewPropsRegistry extends never
        ? ViewProps
        : ViewPropsRegistry[keyof ViewPropsRegistry]
      /**
       * Headers attached to the SSR response, set by `view('id', props, { headers })`.
       * Read by `@rudderjs/vite`'s `+headersResponse` hook.
       */
      viewHeaders?: Record<string, string>
    }
  }
}

export {}
