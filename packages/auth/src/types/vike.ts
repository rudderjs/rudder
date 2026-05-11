/**
 * Vike module augmentation — declares `pageContext.user` for apps using
 * `@rudderjs/auth`. The runtime value is populated by the page-context
 * enhancer registered in `AuthProvider.boot()`.
 *
 * Apps that don't install `@rudderjs/vite`'s `+onCreatePageContext` hook
 * (i.e. don't extend `@rudderjs/vite/config` from their `pages/+config.ts`)
 * will see `undefined` at runtime — the type is intentionally optional.
 */

import type { AuthUser } from '../contracts.js'

declare global {
  namespace Vike {
    interface PageContext {
      /**
       * The currently authenticated user, populated by `@rudderjs/auth`'s
       * page-context enhancer. `null` when no session is active or the
       * request is outside the `AuthMiddleware` async-local context.
       */
      user?: AuthUser | null
    }
  }
}

export {}
