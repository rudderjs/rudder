import type { PanelThemeMeta } from './types.js'

/**
 * Generates a CSS string from resolved theme meta.
 * Produces `:root { ... }` and `.dark { ... }` blocks that override CSS custom properties.
 *
 * Used by both SSR (injected as `<style>` in React tree) and client (ThemeProvider).
 */
export function generateThemeCSS(theme: PanelThemeMeta): string {
  const lightVars = Object.entries(theme.light)
    .map(([k, v]) => `  ${k}: ${v} !important;`)
    .join('\n')

  const darkVars = Object.entries(theme.dark)
    .map(([k, v]) => `  ${k}: ${v} !important;`)
    .join('\n')

  // !important ensures theme overrides Tailwind's @layer declarations
  // and works correctly with .dark class toggling.
  let css = `:root {\n${lightVars}\n  --radius: ${theme.radius} !important;\n`

  if (theme.fontFamily?.body) {
    css += `  --font-sans: ${theme.fontFamily.body} !important;\n`
    css += `  --default-font-family: ${theme.fontFamily.body} !important;\n`
  }
  if (theme.fontFamily?.heading) {
    css += `  --font-heading: ${theme.fontFamily.heading} !important;\n`
  }

  css += '}\n'
  css += `.dark {\n${darkVars}\n}\n`

  // Direct html rule as fallback for body font
  if (theme.fontFamily?.body) {
    css += `html { font-family: var(--default-font-family) !important; }\n`
  }

  // Auto-apply heading font to h1-h6
  if (theme.fontFamily?.heading) {
    css += 'h1, h2, h3, h4, h5, h6 { font-family: var(--font-heading, var(--default-font-family)) !important; }\n'
  }

  return css
}
