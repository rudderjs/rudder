// ─── Toolbar types ──────────────────────────────────────────

/** Available toolbar tool names. */
export type ToolbarTool =
  | 'bold' | 'italic' | 'underline' | 'strikethrough'
  | 'code' | 'link'
  | 'heading' | 'h1' | 'h2' | 'h3'
  | 'bulletList' | 'orderedList'
  | 'blockquote' | 'codeBlock' | 'divider'
  | 'align' | 'indent'
  | 'undo' | 'redo'

/** Toolbar profile names. */
export type ToolbarProfile = 'default' | 'document' | 'simple' | 'minimal' | 'none'

/** Resolved toolbar configuration passed to the editor component. */
export interface ToolbarConfig {
  /** Profile name */
  profile: ToolbarProfile
  /** Which tools are enabled (resolved from profile or explicit list) */
  tools: ToolbarTool[]
  /** Whether toolbar is fixed (pinned to top) or floating (on selection) */
  fixed: boolean
}

// ─── Profile definitions ────────────────────────────────────

const PROFILE_TOOLS: Record<ToolbarProfile, ToolbarTool[]> = {
  document: [
    'undo', 'redo',
    'heading',
    'bold', 'italic', 'underline', 'strikethrough',
    'code', 'link',
    'align',
    'bulletList', 'orderedList',
    'indent',
    'blockquote', 'codeBlock', 'divider',
  ],
  default: [
    'bold', 'italic', 'underline', 'strikethrough',
    'code', 'link',
  ],
  simple: [
    'bold', 'italic', 'link',
    'bulletList', 'orderedList',
    'heading',
  ],
  minimal: [
    'bold', 'italic', 'link',
  ],
  none: [],
}

const FIXED_PROFILES = new Set<ToolbarProfile>(['document'])

// ─── Resolver ───────────────────────────────────────────────

/**
 * Resolve a toolbar profile name or explicit tool list into a ToolbarConfig.
 */
export function resolveToolbar(
  input?: ToolbarProfile | ToolbarTool[] | undefined,
): ToolbarConfig {
  if (!input) {
    return { profile: 'default', tools: PROFILE_TOOLS.default, fixed: false }
  }
  if (Array.isArray(input)) {
    return { profile: 'default', tools: input, fixed: false }
  }
  return {
    profile: input,
    tools: PROFILE_TOOLS[input] ?? PROFILE_TOOLS.default,
    fixed: FIXED_PROFILES.has(input),
  }
}

/** Check if a tool is enabled in the given config. */
export function hasTool(config: ToolbarConfig, tool: ToolbarTool): boolean {
  return config.tools.includes(tool)
}

/** Check if any heading tool is enabled. */
export function hasHeadingTool(config: ToolbarConfig): boolean {
  return config.tools.some(t => t === 'heading' || t === 'h1' || t === 'h2' || t === 'h3')
}
