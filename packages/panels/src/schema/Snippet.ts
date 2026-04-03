// ─── Snippet schema element ─────────────────────────────────
// Tabbed code display with copy button.
//
//   Snippet.make('Install')
//     .tab('npm', 'npx create-rudderjs-app')
//     .tab('yarn', 'yarn create rudderjs-app')
//     .tab('pnpm', 'pnpm create rudderjs-app')
//     .tab('bun', 'bunx create-rudderjs-app')

export interface SnippetTab {
  label:     string
  code:      string
  language?: string
}

export interface SnippetElementMeta {
  type:   'snippet'
  title?: string
  tabs:   SnippetTab[]
}

export class Snippet {
  private _title?: string
  private _tabs:   SnippetTab[] = []

  protected constructor(title?: string) {
    if (title) this._title = title
  }

  static make(title?: string): Snippet {
    return new Snippet(title)
  }

  /** Add a code tab. */
  tab(label: string, code: string, language?: string): this {
    const tab: SnippetTab = { label, code: code.trim() }
    if (language) tab.language = language
    this._tabs.push(tab)
    return this
  }

  getType(): 'snippet' { return 'snippet' }

  toMeta(): SnippetElementMeta {
    const meta: SnippetElementMeta = { type: 'snippet', tabs: this._tabs }
    if (this._title) meta.title = this._title
    return meta
  }
}
