import type { TemplateContext } from '../../templates.js'

export function pagesErrorConfig(ctx: TemplateContext): string {
  switch (ctx.primary) {
    case 'vue':
      return `import type { Config } from 'vike/types'
import vikeVue from 'vike-vue/config'

export default {
  extends: vikeVue,
} satisfies Config
`
    case 'solid':
      return `import type { Config } from 'vike/types'
import vikeSolid from 'vike-solid/config'

export default {
  extends: vikeSolid,
} satisfies Config
`
    default:
      return `import type { Config } from 'vike/types'
import vikeReact from 'vike-react/config'

export default {
  extends: vikeReact,
} satisfies Config
`
  }
}

export function pagesErrorPage(ctx: TemplateContext): string {
  switch (ctx.primary) {
    case 'vue':   return pagesErrorPageVue(ctx)
    case 'solid': return pagesErrorPageSolid(ctx)
    default:      return pagesErrorPageReact(ctx)
  }
}

export function pagesErrorPageReact(ctx: TemplateContext): string {
  const cssImport = `import '@/index.css'\n`
  return `${cssImport}import { usePageContext } from 'vike-react/usePageContext'

export default function Page() {
  const { is404, abortReason, abortStatusCode } = usePageContext() as {
    is404: boolean
    abortStatusCode?: number
    abortReason?: string
  }

  if (is404) {
    return (
      <div className="error-wrap">
        <h1 className="heading-lg">404 — Page Not Found</h1>
        <p className="muted">This page could not be found.</p>
        <a href="/" className="error-link">Go home</a>
      </div>
    )
  }

  if (abortStatusCode === 401) {
    return (
      <div className="error-wrap">
        <h1 className="heading-lg">401 — Unauthorized</h1>
        <p className="muted">{abortReason ?? 'You must be logged in to view this page.'}</p>
        <a href="/" className="error-link">Go home</a>
      </div>
    )
  }

  return (
    <div className="error-wrap">
      <h1 className="heading-lg">Something went wrong</h1>
      <p className="muted">{abortReason ?? 'An unexpected error occurred.'}</p>
      <a href="/" className="error-link">Go home</a>
    </div>
  )
}
`
}

export function pagesErrorPageVue(ctx: TemplateContext): string {
  const cssImport = `import '@/index.css'\n`
  return `<script setup lang="ts">
${cssImport}import { usePageContext } from 'vike-vue/usePageContext'

const pageContext = usePageContext() as {
  is404: boolean
  abortStatusCode?: number
  abortReason?: string
}
</script>

<template>
  <div v-if="pageContext.is404" class="error-wrap">
    <h1 class="heading-lg">404 — Page Not Found</h1>
    <p class="muted">This page could not be found.</p>
    <a href="/" class="error-link">Go home</a>
  </div>
  <div v-else-if="pageContext.abortStatusCode === 401" class="error-wrap">
    <h1 class="heading-lg">401 — Unauthorized</h1>
    <p class="muted">{{ pageContext.abortReason ?? 'You must be logged in to view this page.' }}</p>
    <a href="/" class="error-link">Go home</a>
  </div>
  <div v-else class="error-wrap">
    <h1 class="heading-lg">Something went wrong</h1>
    <p class="muted">{{ pageContext.abortReason ?? 'An unexpected error occurred.' }}</p>
    <a href="/" class="error-link">Go home</a>
  </div>
</template>
`
}

export function pagesErrorPageSolid(ctx: TemplateContext): string {
  const cssImport = `import '@/index.css'\n`
  return `${cssImport}import { Switch, Match } from 'solid-js'
import { usePageContext } from 'vike-solid/usePageContext'

export default function Page() {
  const pageContext = usePageContext() as {
    is404: boolean
    abortStatusCode?: number
    abortReason?: string
  }

  return (
    <Switch>
      <Match when={pageContext.is404}>
        <div class="error-wrap">
          <h1 class="heading-lg">404 — Page Not Found</h1>
          <p class="muted">This page could not be found.</p>
          <a href="/" class="error-link">Go home</a>
        </div>
      </Match>
      <Match when={pageContext.abortStatusCode === 401}>
        <div class="error-wrap">
          <h1 class="heading-lg">401 — Unauthorized</h1>
          <p class="muted">{pageContext.abortReason ?? 'You must be logged in to view this page.'}</p>
          <a href="/" class="error-link">Go home</a>
        </div>
      </Match>
      <Match when={true}>
        <div class="error-wrap">
          <h1 class="heading-lg">Something went wrong</h1>
          <p class="muted">{pageContext.abortReason ?? 'An unexpected error occurred.'}</p>
          <a href="/" class="error-link">Go home</a>
        </div>
      </Match>
    </Switch>
  )
}
`
}
