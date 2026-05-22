/**
 * Detect when create-rudder-app is running inside an AI coding agent.
 *
 * In agent contexts the interactive @clack/prompts UI degrades to garbage
 * (TTY redraws, ANSI escapes the agent can't fill in), and the agent often
 * just hangs or times out. When detected, the installer switches to a
 * non-interactive flag-driven mode and emits a single line of JSON to stdout.
 *
 * Inspired by Laravel Installer v5.27 (Joe Tannenbaum, 2025).
 */
export interface AgentDetectionResult {
  detected: boolean
  /** Friendly name of the detected agent, included in JSON output. */
  name?:    string
}

/**
 * Inspect process.env for markers set by common agent runtimes.
 * Returns the first match in declaration order.
 */
export function detectAgent(env: NodeJS.ProcessEnv = process.env): AgentDetectionResult {
  // Claude Code — sets CLAUDECODE=1 and CLAUDE_CODE_ENTRYPOINT
  if (env['CLAUDECODE'] || env['CLAUDE_CODE_ENTRYPOINT']) {
    return { detected: true, name: 'claude-code' }
  }
  // Cursor — sets CURSOR_TRACE_ID; also reports TERM_PROGRAM=cursor in the integrated terminal
  if (env['CURSOR_TRACE_ID'] || env['TERM_PROGRAM'] === 'cursor') {
    return { detected: true, name: 'cursor' }
  }
  // GitHub Copilot CLI
  if (env['GITHUB_COPILOT_CLI']) {
    return { detected: true, name: 'copilot' }
  }
  // OpenAI Codex CLI
  if (env['CODEX_CLI'] || env['OPENAI_CODEX']) {
    return { detected: true, name: 'codex' }
  }
  // Google Gemini CLI
  if (env['GEMINI_CLI']) {
    return { detected: true, name: 'gemini' }
  }
  // Windsurf
  if (env['WINDSURF_AGENT'] || env['WINDSURF']) {
    return { detected: true, name: 'windsurf' }
  }
  // Generic opt-in (CI, scripts, custom integrations)
  if (env['RUDDER_NONINTERACTIVE'] === '1' || env['RUDDER_NONINTERACTIVE'] === 'true') {
    return { detected: true, name: 'noninteractive' }
  }
  return { detected: false }
}
