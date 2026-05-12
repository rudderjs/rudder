/**
 * Vike module augmentation — declares `pageContext.locale`, populated by the
 * page-context enhancer registered in `LocalizationProvider.boot()`.
 *
 * Apps without `@rudderjs/vite`'s `+onCreatePageContext` hook will see
 * `undefined` at runtime — the type is intentionally optional.
 */

declare global {
  namespace Vike {
    interface PageContext {
      /**
       * Active locale for the request, populated by `@rudderjs/localization`'s
       * page-context enhancer. Falls back to the config default outside the
       * locale ALS context.
       */
      locale?: string
    }
  }
}

export {}
