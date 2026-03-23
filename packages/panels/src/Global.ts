import type { PanelContext } from './types.js'
import type { FieldOrGrouping, SchemaItemMeta } from './Resource.js'
import { Form } from './schema/Form.js'

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

  // ── form() ────────────────────────────────────────────

  /**
   * Configure the global's form.
   * Receives a pre-configured Form with the global slug as ID.
   *
   * @example
   * form(form: Form) {
   *   return form.fields([
   *     TextField.make('siteName').required(),
   *     ToggleField.make('maintenanceMode'),
   *   ])
   * }
   */
  form(form: Form): Form {
    return form
  }

  /** Authorization policy. Return false to deny — API responds 403. */
  async policy(_action: 'view' | 'update', _ctx: PanelContext): Promise<boolean> {
    return true
  }

  // ── Internal resolvers ────────────────────────────────

  /** @internal — Constructs Form, calls this.form(). */
  _resolveForm(): Form {
    const Cls = this.constructor as typeof Global
    return this.form(Form.make(Cls.getSlug()))
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
    const form = this._resolveForm()
    const formMeta = form.toMeta()
    return {
      label:     Cls.getLabel(),
      slug:      Cls.getSlug(),
      icon:      Cls.icon,
      fields:    formMeta.fields as SchemaItemMeta[],
      versioned: !!formMeta.versioned,
    }
  }
}
