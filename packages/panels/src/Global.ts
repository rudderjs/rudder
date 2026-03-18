import type { PanelContext } from './types.js'
import type { FieldOrGrouping, SchemaItemMeta } from './Resource.js'

// ─── Global meta (for UI / meta endpoint) ───────────────

export interface GlobalMeta {
  label:       string
  slug:        string
  icon:        string | undefined
  fields:      SchemaItemMeta[]
  versioned:   boolean
}

// ─── Global base class ──────────────────────────────────

/**
 * A Global represents a single-record settings page in a panel.
 *
 * Unlike a Resource (which manages a list of records), a Global always
 * operates on exactly one row — identified by its slug in the `Global`
 * database table.
 *
 * Globals share the same Field, Section, and Tabs infrastructure as
 * Resources, and support collaborative editing when `versioned = true`.
 *
 * @example
 * ```ts
 * class SiteSettingsGlobal extends Global {
 *   static slug = 'site-settings'
 *   static label = 'Site Settings'
 *   static icon = '⚙️'
 *
 *   fields() {
 *     return [
 *       TextField.make('siteName').required(),
 *       ToggleField.make('maintenanceMode'),
 *     ]
 *   }
 * }
 * ```
 */
export class Global {
  // ── Static configuration ────────────────────────────────

  /** Display label (e.g. 'Site Settings'). Derived from class name if not set. */
  static label?: string

  /** URL slug (e.g. 'site-settings'). Derived from class name if not set. */
  static slug?: string

  /** Icon for the sidebar (optional). */
  static icon?: string

  /**
   * Enable Yjs-backed collaborative editing for this global.
   * Uses the same @boostkit/live infrastructure as versioned resources.
   */
  static versioned = false

  // ── Abstract / overridable ──────────────────────────────

  /** Define the fields (and optional Section / Tabs groupings) for this global. Required. */
  fields(): FieldOrGrouping[] {
    throw new Error(`[BoostKit Panels] Global "${this.constructor.name}" must implement fields().`)
  }

  /**
   * Authorization policy.
   * Return false to deny the action — the API responds with 403.
   * Defaults to allowing everything.
   */
   
  async policy(_action: 'view' | 'update', _ctx: PanelContext): Promise<boolean> {
    return true
  }

  // ── Static helpers ──────────────────────────────────────

  static getSlug(): string {
    if (this.slug) return this.slug
    const name = this.name.replace(/Global$/, '')
    return name
      .replace(/([A-Z])/g, (m) => `-${m.toLowerCase()}`)
      .replace(/^-/, '')
  }

  static getLabel(): string {
    if (this.label) return this.label
    const name = this.name.replace(/Global$/, '')
    return name.replace(/([A-Z])/g, ' $1').trim()
  }

  // ── Instance meta ───────────────────────────────────────

  /** @internal */
  toMeta(): GlobalMeta {
    const Cls = this.constructor as typeof Global
    return {
      label:     Cls.getLabel(),
      slug:      Cls.getSlug(),
      icon:      Cls.icon,
      fields:    this.fields().map((f) => f.toMeta()) as SchemaItemMeta[],
      versioned: Cls.versioned,
    }
  }
}
