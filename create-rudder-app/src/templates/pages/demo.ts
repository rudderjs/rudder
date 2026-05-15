import type { TemplateContext } from '../../templates.js'

export function demoPageConfig(fw: 'react' | 'vue' | 'solid'): string {
  switch (fw) {
    case 'vue':
      return `import type { Config } from 'vike/types'
import vikeVue from 'vike-vue/config'

export default {
  extends: vikeVue,
} as unknown as Config
`
    case 'solid':
      return `import type { Config } from 'vike/types'
import vikeSolid from 'vike-solid/config'

export default {
  extends: vikeSolid,
} as unknown as Config
`
    default: // react
      // vike-react 0.6.23+ fixed vikejs/vike#3251 — no cast needed.
      return `import type { Config } from 'vike/types'
import vikeReact from 'vike-react/config'

export default {
  extends: vikeReact,
} satisfies Config
`
  }
}

export function demoPage(fw: 'react' | 'vue' | 'solid', ctx: TemplateContext): string {
  const { primary } = ctx

  switch (fw) {
    case 'react':
      return `export default function Page() {
  return (
    <div className="error-wrap">
      <h1 className="heading-lg">Hello from React</h1>
      <p className="muted">React demo page — running alongside ${primary}.</p>
      <a href="/" className="auth-link muted">← Back to home</a>
    </div>
  )
}
`

    case 'vue':
      return `<script setup lang="ts">
import '@/index.css'
</script>

<template>
  <div class="error-wrap">
    <h1 class="heading-lg">Hello from Vue</h1>
    <p class="muted">Vue demo page — running alongside ${primary}.</p>
    <a href="/" class="auth-link muted">← Back to home</a>
  </div>
</template>
`

    case 'solid':
      return `import '@/index.css'

export default function Page() {
  return (
    <div class="error-wrap">
      <h1 class="heading-lg">Hello from Solid</h1>
      <p class="muted">Solid demo page — running alongside ${primary}.</p>
      <a href="/" class="auth-link muted">← Back to home</a>
    </div>
  )
}
`
  }
}
