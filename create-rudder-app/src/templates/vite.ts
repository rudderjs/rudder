import type { TemplateContext } from '../templates.js'

export function viteConfig(ctx: TemplateContext): string {
  const { frameworks, primary, tailwind } = ctx
  const hasReact = frameworks.includes('react')
  const hasVue   = frameworks.includes('vue')
  const hasSolid = frameworks.includes('solid')
  const hasReactSolidConflict = hasReact && hasSolid

  const imports: string[] = [
    `import { defineConfig } from 'vite'`,
    `import vike from 'vike/plugin'`,
    `import rudderjs from '@rudderjs/vite'`,
  ]
  if (tailwind) imports.push(`import tailwindcss from '@tailwindcss/vite'`)
  if (hasReact)  imports.push(`import react from '@vitejs/plugin-react'`)
  if (hasVue)    imports.push(`import vue from '@vitejs/plugin-vue'`)
  if (hasSolid)  imports.push(`import solid from 'vike-solid/vite'`)

  // `rudderjs()` BEFORE `vike()` — the views-scanner writes auto-generated
  // stubs to `pages/__view/` during plugin construction, and Vike scans
  // `pages/` during its own construction, so the stubs must exist before
  // `vike()` is called.
  const plugins: string[] = ['rudderjs()', 'vike()']
  if (tailwind) plugins.push('tailwindcss()')

  if (hasReact) {
    if (hasReactSolidConflict) {
      if (primary === 'react') {
        plugins.push(`react({ exclude: ['**/pages/solid-demo/**'] })`)
      } else {
        plugins.push(`react({ include: ['**/pages/react-demo/**'] })`)
      }
    } else {
      plugins.push('react()')
    }
  }

  if (hasVue) {
    plugins.push('vue()')
  }

  if (hasSolid) {
    if (hasReactSolidConflict) {
      if (primary === 'solid') {
        plugins.push(`solid({ exclude: ['**/pages/react-demo/**'] })`)
      } else {
        plugins.push(`solid({ include: ['**/pages/solid-demo/**'] })`)
      }
    } else {
      plugins.push('solid()')
    }
  }

  const pluginsStr = plugins.map(p => `    ${p},`).join('\n')

  return `${imports.join('\n')}

export default defineConfig({
  plugins: [
${pluginsStr}
  ],
})
`
}
