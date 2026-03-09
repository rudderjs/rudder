// ─── Page meta (for UI / meta endpoint) ────────────────────

export interface PageMeta {
  slug:  string
  label: string
  icon:  string | undefined
}

// ─── Page base class ────────────────────────────────────────

export class Page {
  /** URL slug (e.g. 'dashboard'). Derived from class name if not set. */
  static slug?: string

  /** Sidebar label (e.g. 'Dashboard'). Derived from class name if not set. */
  static label?: string

  /** Optional icon string shown in the sidebar. */
  static icon?: string

  // ── Static helpers ──────────────────────────────────────

  static getSlug(): string {
    if (this.slug) return this.slug
    // DashboardPage → dashboard, SettingsPage → settings
    return this.name.replace(/Page$/, '').toLowerCase()
  }

  static getLabel(): string {
    if (this.label) return this.label
    const name = this.name.replace(/Page$/, '')
    return name.replace(/([A-Z])/g, ' $1').trim()
  }

  /** @internal */
  static toMeta(): PageMeta {
    return {
      slug:  this.getSlug(),
      label: this.getLabel(),
      icon:  this.icon,
    }
  }
}
