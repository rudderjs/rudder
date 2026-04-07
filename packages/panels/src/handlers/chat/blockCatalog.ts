import type { Resource, FieldOrGrouping } from '../../Resource.js'
import type { Field, FieldMeta } from '../../schema/Field.js'
import type { Section } from '../../schema/Section.js'
import type { Tabs } from '../../schema/Tabs.js'
import type { BlockMeta } from '../../schema/Block.js'
import { FieldType } from '../../schema/FieldType.js'

// ─── Catalog shape ──────────────────────────────────────────

/**
 * One builder field on the resource form, with the block types it accepts.
 * Sourced from `BuilderField.blocks([...])` declarations — no inference from
 * runtime Lexical JSON.
 */
export interface BuilderFieldCatalog {
  /** Form field name (e.g. `"content"`). */
  fieldName: string
  /** Field's display label (e.g. `"Content"`). */
  fieldLabel: string
  /** Block types declared via `BuilderField.blocks([...])`. */
  blocks: BlockMeta[]
}

// ─── Extractor ──────────────────────────────────────────────

/**
 * Walk a resource's form schema and return every `BuilderField` together
 * with its declared block catalog.
 *
 * Returns `[]` when the resource has no builder fields, or when builder
 * fields exist but no blocks have been declared on them. The catalog is
 * the structured-metadata equivalent of LSP autocomplete: the agent walks
 * into the conversation already knowing which block types exist on this
 * resource and what fields each block accepts, instead of inferring from
 * raw Lexical JSON.
 */
export function extractBuilderCatalog(resource: Resource): BuilderFieldCatalog[] {
  const out: BuilderFieldCatalog[] = []

  function walk(items: FieldOrGrouping[]): void {
    for (const item of items) {
      if (isField(item)) {
        if (item.getType() === FieldType.Builder) {
          const blocks = (item.getExtra()['blocks'] as BlockMeta[] | undefined) ?? []
          if (blocks.length > 0) {
            out.push({
              fieldName:  item.getName(),
              fieldLabel: item.toMeta().label,
              blocks,
            })
          }
        }
      }
      // Tabs exposes both getFields() (flat) and getTabs() (structured) — only
      // walk via getTabs to avoid double-counting builder fields nested in tabs.
      if ('getTabs' in item && typeof (item as Tabs).getTabs === 'function') {
        for (const tab of (item as Tabs).getTabs()) {
          walk(tab.getFields() as unknown as FieldOrGrouping[])
        }
      } else if ('getFields' in item && typeof (item as Section).getFields === 'function') {
        walk((item as Section).getFields() as unknown as FieldOrGrouping[])
      }
    }
  }

  walk(resource._resolveForm().getFields())
  return out
}

function isField(item: FieldOrGrouping): item is Field {
  return 'getName' in item && 'getType' in item && 'getExtra' in item
}

// ─── Formatter ──────────────────────────────────────────────

/**
 * Render a catalog as a markdown system-prompt section. Returns an empty
 * string if the catalog is empty so callers can unconditionally concatenate.
 *
 * Format choice: one fenced block per builder field, listing every block
 * type with its name, label, and field schema. Compact enough to inject
 * statically (typically a few hundred tokens for a real-world resource),
 * structured enough for the agent to call `update_block` with confidence.
 */
export function formatBuilderCatalog(catalog: BuilderFieldCatalog[]): string {
  if (catalog.length === 0) return ''

  const lines: string[] = []
  lines.push('## Available block types')
  lines.push('')
  lines.push('When the user asks you to edit blocks in a builder field, use the catalog below — do NOT guess block names or field names from the rendered `[BLOCK: ...]` placeholders. Each builder field declares which block types it accepts and what fields each block has.')
  lines.push('')

  for (const builder of catalog) {
    lines.push(`### \`${builder.fieldName}\` field — "${builder.fieldLabel}"`)
    for (const block of builder.blocks) {
      lines.push(`- **\`${block.name}\`** — ${block.label}${block.icon ? ` (${block.icon})` : ''}`)
      if (block.schema.length === 0) {
        lines.push('  - _no fields_')
        continue
      }
      for (const field of block.schema) {
        lines.push(`  - \`${field.name}\` (${field.type})${field.required ? ' — required' : ''}`)
      }
    }
    lines.push('')
  }

  lines.push('To edit a block, call `edit_text` with an `update_block` operation:')
  lines.push('  `{ type: "update_block", blockType: "<block name from above>", blockIndex: 0, field: "<field name from the block schema>", value: "<new value>" }`')
  lines.push('Use `blockIndex` to disambiguate multiple blocks of the same type (0-based).')

  return lines.join('\n')
}

// ─── Convenience ────────────────────────────────────────────

/**
 * One-shot helper: extract the catalog for a resource and render it as a
 * system-prompt section. Returns an empty string when the resource has no
 * builder fields with declared blocks.
 */
export function buildBuilderCatalogPrompt(resource: Resource): string {
  return formatBuilderCatalog(extractBuilderCatalog(resource))
}

/**
 * Tiny one-line summary suitable for the prompt header — e.g.
 * `"builder fields: content (5 block types), heroBuilder (2 block types)"`.
 *
 * Useful when callers want a hint without the full schema (or for the
 * future hybrid mode where the detail moves to a `describe_blocks` tool).
 */
export function summarizeBuilderCatalog(catalog: BuilderFieldCatalog[]): string {
  if (catalog.length === 0) return ''
  return catalog
    .map(b => `${b.fieldName} (${b.blocks.length} block type${b.blocks.length === 1 ? '' : 's'})`)
    .join(', ')
}
