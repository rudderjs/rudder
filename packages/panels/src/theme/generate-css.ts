import type { PanelThemeMeta } from './types.js'

/**
 * Generates a CSS string from resolved theme meta.
 * Produces `:root { ... }` and `.dark { ... }` blocks that override CSS custom properties.
 *
 * Used by both SSR (injected as `<style>` in React tree) and client (ThemeProvider).
 */
export function generateThemeCSS(theme: PanelThemeMeta): string {
  const lightVars = Object.entries(theme.light)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n')

  const darkVars = Object.entries(theme.dark)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n')

  // Use :root:root for higher specificity — ensures theme overrides
  // the app's index.css :root variables (Vite may inject those after our <style>).
  let css = `:root:root {\n${lightVars}\n  --radius: ${theme.radius};\n`

  if (theme.fontFamily?.body) {
    css += `  --font-sans: ${theme.fontFamily.body};\n`
  }
  if (theme.fontFamily?.heading) {
    css += `  --font-heading: ${theme.fontFamily.heading};\n`
  }

  css += '}\n'
  css += `:root:root.dark {\n${darkVars}\n}\n`

  // Auto-apply heading font to h1-h6
  if (theme.fontFamily?.heading) {
    css += 'h1, h2, h3, h4, h5, h6 { font-family: var(--font-heading, var(--font-sans)); }\n'
  }

  return css
}
