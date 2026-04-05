import { Page } from './Page.js'

/**
 * Built-in theme editor page — auto-registered when `Panel.themeEditor()` is called.
 * The frontend renders a custom component when it detects `slug === 'theme'`.
 */
export class ThemeSettingsPage extends Page {
  static override slug = 'theme'
  static override label = 'Theme'
  static override icon = 'palette'
  static override navigationParent = 'Settings'
}
