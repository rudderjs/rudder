import { Field } from '@rudderjs/panels'
import type { BlockMeta } from '@rudderjs/panels'
import type { ToolbarProfile, ToolbarTool } from './toolbar.js'

export class RichContentField extends Field {
  protected _blocks: BlockMeta[] = []

  static make(name: string): RichContentField {
    return new RichContentField(name)
  }

  /** Placeholder text shown when the editor is empty. */
  placeholder(text: string): this {
    this._extra['placeholder'] = text
    return this
  }

  /** Register custom block types (Payload CMS-style). */
  blocks(blocks: { toMeta(): BlockMeta }[]): this {
    this._blocks = blocks.map(b => b.toMeta())
    this._extra['blocks'] = this._blocks
    return this
  }

  /**
   * Set the toolbar profile or explicit tool list.
   *
   * Profiles:
   * - `'default'`  — floating toolbar on selection (B, I, U, S, code, link)
   * - `'document'` — Google Docs-style fixed toolbar pinned to top (all tools)
   * - `'simple'`   — floating with bold, italic, link, lists, heading
   * - `'minimal'`  — floating with bold, italic, link only
   * - `'none'`     — no toolbar
   *
   * Or pass an explicit array of tool names:
   * ```ts
   * .toolbar(['bold', 'italic', 'heading', 'link', 'bulletList'])
   * ```
   *
   * @example
   * RichContentField.make('content').toolbar('document')
   * RichContentField.make('notes').toolbar('simple')
   * RichContentField.make('bio').toolbar(['bold', 'italic', 'link'])
   */
  toolbar(profile: ToolbarProfile | ToolbarTool[]): this {
    this._extra['toolbar'] = profile
    return this
  }

  /**
   * Control the slash command menu.
   * - `false` — disable slash commands entirely
   * - Array of tool names — show only these items (custom blocks always appear)
   * - Default: follows toolbar profile
   */
  slashCommand(value: boolean | ToolbarTool[]): this {
    this._extra['slashCommand'] = value
    return this
  }

  getType(): string { return 'richcontent' }
}
