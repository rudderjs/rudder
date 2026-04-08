/**
 * Built-in AI quick actions for text fields.
 *
 * Each action is a real `PanelAgent` instance — same primitive as resource
 * agents defined in user code via `PanelAgent.make(...)`. Registered with
 * `BuiltInAiActionRegistry` by `PanelServiceProvider.register()` (the sync
 * phase, before any field meta builds).
 *
 * **Text family only** (per Q3 in `docs/plans/standalone-client-tools-plan.md`):
 * non-text actions are too domain-specific to ship as universal built-ins.
 * App devs define custom `PanelAgent`s for `number` / `boolean` / `select` /
 * `tags` / `relation` / etc., with their own `appliesTo` declarations.
 *
 * **Labels** are stored as English defaults here. The field meta layer
 * resolves them to localised strings via `getPanelI18n()` at serialisation
 * time using the `aiAction_<slug>` keys (see D9 + Q4). The `_label` you see
 * in this file is the fallback if i18n isn't available.
 *
 * **Instructions** use `{field}` interpolation (D9). The standalone agent
 * runner replaces it with the field name from the request body when the
 * action runs from a per-field click.
 *
 * **Tools** come from `PanelAgent.buildTools()` which already includes the
 * full toolkit (`update_field`, `read_record`, `edit_text`,
 * `update_form_state`, `read_form_state`) — see Q6.
 */

import { PanelAgent } from '../agents/PanelAgent.js'

const TEXT_FIELD_TYPES = ['text', 'textarea', 'richcontent', 'content']

function makeTextAction(slug: string, label: string, icon: string, instructions: string): PanelAgent {
  return PanelAgent.make(slug)
    .label(label)
    .icon(icon)
    .appliesTo(TEXT_FIELD_TYPES)
    .instructions(instructions)
}

const COMMON_RULES = [
  'Operate ONLY on the {field} field — do not touch any other field.',
  'For collaborative text/rich-content fields use the `edit_text` tool with a `rewrite` operation.',
  'For non-collaborative text fields use the `update_form_state` tool so unsaved local edits are preserved.',
  'Never use `update_field` for text — it bypasses the live form state.',
].join(' ')

export const builtInActions: PanelAgent[] = [
  makeTextAction(
    'rewrite',
    'Rewrite',
    'Sparkles',
    `Rewrite the value of the {field} field while preserving its meaning. Keep the same approximate length and tone. ${COMMON_RULES}`,
  ),

  makeTextAction(
    'shorten',
    'Shorten',
    'Minimize2',
    `Shorten the value of the {field} field while preserving the key points. Aim for roughly half the original length. ${COMMON_RULES}`,
  ),

  makeTextAction(
    'expand',
    'Expand',
    'Maximize2',
    `Expand the value of the {field} field with more detail. Add concrete examples and supporting context where appropriate. Keep the original tone. ${COMMON_RULES}`,
  ),

  makeTextAction(
    'fix-grammar',
    'Fix grammar',
    'CheckCheck',
    `Fix any grammar, spelling, and punctuation mistakes in the {field} field. Preserve the meaning, tone, and style — only correct mechanical errors. ${COMMON_RULES}`,
  ),

  makeTextAction(
    'translate',
    'Translate',
    'Languages',
    `Translate the value of the {field} field. The user will indicate the target language in the prompt. ${COMMON_RULES}`,
  ),

  makeTextAction(
    'summarize',
    'Summarize',
    'AlignLeft',
    `Summarize the value of the {field} field concisely. Capture the key points in 1-3 sentences. ${COMMON_RULES}`,
  ),

  makeTextAction(
    'make-formal',
    'Make formal',
    'Briefcase',
    `Rewrite the value of the {field} field in a more formal tone. Replace casual language with professional phrasing while preserving meaning. ${COMMON_RULES}`,
  ),

  makeTextAction(
    'simplify',
    'Simplify',
    'Lightbulb',
    `Simplify the value of the {field} field so it is easier to understand. Use plain language and shorter sentences. Preserve all the original information. ${COMMON_RULES}`,
  ),
]
