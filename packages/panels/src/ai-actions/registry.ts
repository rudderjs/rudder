/**
 * Registry of available AI quick actions for fields.
 *
 * Mirrors the shape of every other RudderJS registry (`PanelRegistry`,
 * `CacheRegistry`, `clientTools.ts`, etc.) — the framework's default
 * extension mechanism. Built-in actions are registered by
 * `PanelServiceProvider.register()` (sync phase, before any field meta
 * builds); app code can register additional actions or override built-ins
 * by registering a `PanelAgent` with the same slug from its own provider's
 * `register()` (later wins).
 *
 * Field-level usage:
 *
 * ```ts
 * TextField.make('metaTitle')
 *   .ai(['rewrite', 'shorten'])           // built-in slugs
 *
 * TextField.make('metaTitle')
 *   .ai([rewriteAction, customSeoAgent])  // PanelAgent instances (mixed)
 * ```
 *
 * The `Field.ai()` setter resolves slugs to registered `PanelAgent`s and
 * validates `appliesTo` against the field's type — see D10 in
 * `docs/plans/standalone-client-tools-plan.md`.
 */

import type { PanelAgent } from '../agents/PanelAgent.js'

const actions = new Map<string, PanelAgent>()

export class BuiltInAiActionRegistry {
  /** Register an action by slug. Later registrations with the same slug win (override pattern). */
  static register(action: PanelAgent): void {
    actions.set(action.getSlug(), action)
  }

  /** Look up an action by slug. Returns `undefined` if no match. */
  static get(slug: string): PanelAgent | undefined {
    return actions.get(slug)
  }

  /** True if a slug is registered. */
  static has(slug: string): boolean {
    return actions.has(slug)
  }

  /** All registered actions in registration order. */
  static all(): PanelAgent[] {
    return [...actions.values()]
  }

  /** Remove every registered action. Test/HMR escape hatch. */
  static reset(): void {
    actions.clear()
  }
}
