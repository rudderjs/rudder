/**
 * Vike module augmentation — declares `pageContext.flash`, populated by the
 * page-context enhancer registered in `SessionProvider.boot()`.
 *
 * Apps without `@rudderjs/vite`'s `+onCreatePageContext` hook will see
 * `undefined` at runtime — the type is intentionally optional.
 */

declare global {
  namespace Vike {
    interface PageContext {
      /**
       * All flash values from the previous request. Populated by
       * `@rudderjs/session`'s page-context enhancer. `{}` when no session
       * is active or the request is outside the session ALS context.
       */
      flash?: Record<string, unknown>
    }
  }
}

export {}
