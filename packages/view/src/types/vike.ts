/**
 * Vike module augmentation — declares `pageContext.viewHeaders`,
 * populated by `ViewResponse.toResponse()` and consumed by
 * `@rudderjs/vite`'s `+headersResponse` hook.
 *
 * `pageContext.viewProps` is also forwarded (set by the same renderPage()
 * call) and exposed here for consuming view components.
 */

import type { ViewProps } from '../index.js'

declare global {
  namespace Vike {
    interface PageContext {
      /** Props passed to the view component, set by `view('id', props)`. */
      viewProps?: ViewProps
      /**
       * Headers attached to the SSR response, set by `view('id', props, { headers })`.
       * Read by `@rudderjs/vite`'s `+headersResponse` hook.
       */
      viewHeaders?: Record<string, string>
    }
  }
}

export {}
