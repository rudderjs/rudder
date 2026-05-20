/**
 * Editor-launch URL builders for dev error-page stack frames.
 *
 * Each supported editor exposes a URL scheme that opens a file at a given
 * line when the URL is dispatched (clicked in the browser). The browser
 * delegates to the OS, which routes the scheme to the matching app.
 *
 * `APP_EDITOR` env var picks the scheme (default `vscode`); `none` opts out
 * and the renderer falls back to plain text.
 *
 * Path normalization: paths are URL-encoded so spaces / unicode survive the
 * shell hop. On Windows, the path is forward-slashed before encoding —
 * `C:\Users\alice\file.ts` becomes `C:/Users/alice/file.ts`. macOS/Linux
 * paths pass through unchanged. The leading `/` on unix produces a
 * `file//path/to/file` (double slash) in the URL which all the major
 * editors accept.
 */

export type EditorName =
  | 'vscode'
  | 'cursor'
  | 'webstorm'
  | 'phpstorm'
  | 'idea'
  | 'sublime'
  | 'atom'
  | 'none'

const URL_TEMPLATES: Record<Exclude<EditorName, 'none'>, (path: string, line: number) => string> = {
  // VS Code + Cursor: `vscode://file/<path>:<line>` (Cursor uses the same path
  // shape with its own protocol — both consume the `:<line>` suffix).
  vscode:   (p, l) => `vscode://file${p}:${l}`,
  cursor:   (p, l) => `cursor://file${p}:${l}`,
  // JetBrains family: documented `<product>://open?file=<path>&line=<line>`.
  // `idea://` is the IntelliJ alias and works across the IDE family; the
  // explicit per-product schemes (webstorm / phpstorm / etc) are first-class
  // too — give the user the choice rather than picking one for them.
  webstorm: (p, l) => `webstorm://open?file=${encodeURIComponent(p)}&line=${l}`,
  phpstorm: (p, l) => `phpstorm://open?file=${encodeURIComponent(p)}&line=${l}`,
  idea:     (p, l) => `idea://open?file=${encodeURIComponent(p)}&line=${l}`,
  // Sublime: `subl://open?url=file://<path>&line=<line>`
  sublime:  (p, l) => `subl://open?url=file://${encodeURIComponent(p)}&line=${l}`,
  // Atom (the editor's discontinued but installations exist): `atom://core/open/file?filename=<path>&line=<line>`
  atom:     (p, l) => `atom://core/open/file?filename=${encodeURIComponent(p)}&line=${l}`,
}

/**
 * Forward-slash Windows paths so the URL is well-formed. macOS/Linux pass
 * through. Drive letters like `C:` stay; only the backslashes are flipped.
 */
function normalizePathForUrl(file: string): string {
  // Cheap test: any backslash means we're on Windows-shaped input.
  return file.includes('\\') ? file.replace(/\\/g, '/') : file
}

/**
 * Build the URL that opens the given file:line in the configured editor.
 * Returns `null` when `editor === 'none'` (opt-out) or the editor name
 * isn't recognized — the renderer then falls back to plain-text frames.
 *
 * Exported for testing; the error-page renderer calls this per-frame.
 */
export function buildEditorUrl(editor: EditorName, file: string, line: number): string | null {
  if (editor === 'none') return null
  const template = URL_TEMPLATES[editor]
  if (!template) return null
  const normalized = normalizePathForUrl(file)
  return template(normalized, line)
}

/**
 * Resolve `APP_EDITOR` from env. Unrecognized values fall back to `vscode`
 * with a single dev-mode warning so a typo doesn't silently strip every
 * frame's link. `none` opts out cleanly.
 */
export function resolveEditor(envValue: string | undefined = process.env['APP_EDITOR']): EditorName {
  if (!envValue) return 'vscode'
  const v = envValue.toLowerCase() as EditorName
  if (v === 'none') return 'none'
  if (v in URL_TEMPLATES) return v
  // Unknown editor name — log once per process, default to vscode.
  if (!_warnedUnknown.has(envValue)) {
    _warnedUnknown.add(envValue)
    console.warn(
      `[RudderJS] Unknown APP_EDITOR="${envValue}". Falling back to "vscode". ` +
      `Supported: ${Object.keys(URL_TEMPLATES).join(', ')}, none.`,
    )
  }
  return 'vscode'
}

const _warnedUnknown = new Set<string>()

/** @internal — for tests; resets the warned-set so repeat calls re-warn. */
export function _resetEditorWarnings(): void {
  _warnedUnknown.clear()
}
