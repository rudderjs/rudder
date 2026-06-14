import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, cpSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Copy a skill directory, replacing any prior copy. `cpSync` merges into an
 * existing target — it never prunes — so without the up-front remove, a file
 * deleted or renamed in a newer package version would linger and the installed
 * skill would accumulate stale files across upgrades. Remove-then-copy keeps the
 * destination an exact mirror of the source.
 */
export function copySkill(sourcePath: string, destPath: string): void {
  rmSync(destPath, { recursive: true, force: true })
  cpSync(sourcePath, destPath, { recursive: true })
}

const GUIDELINE_OPEN = '<rudderjs-boost-guidelines>'
const GUIDELINE_CLOSE = '</rudderjs-boost-guidelines>'

/**
 * Write Boost's generated guideline block into a file WITHOUT destroying any
 * user-authored content. The generated `content` is wrapped in
 * `<rudderjs-boost-guidelines>…</rudderjs-boost-guidelines>` markers:
 *
 *  - File doesn't exist → write the content as-is.
 *  - File already has the marked block → replace ONLY that block in place,
 *    preserving everything before and after it.
 *  - File exists without the block → append it, keeping the user's content.
 *
 * This is what makes `boost:install` / `boost:update` idempotent and
 * non-destructive: a developer's hand-written CLAUDE.md / AGENTS.md / etc. is
 * no longer clobbered on install (the markers exist precisely for this splice).
 */
export function writeGuidelineBlock(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true })

  if (!existsSync(filePath)) {
    writeFileSync(filePath, content, 'utf-8')
    return
  }

  const existing = readFileSync(filePath, 'utf-8')
  const start = existing.indexOf(GUIDELINE_OPEN)
  const end = existing.indexOf(GUIDELINE_CLOSE)

  if (start !== -1 && end !== -1 && end > start) {
    const before = existing.slice(0, start)
    const after = existing.slice(end + GUIDELINE_CLOSE.length)
    writeFileSync(filePath, before + content.trim() + after, 'utf-8')
    return
  }

  // No existing block — append, leaving the user's current content intact.
  const sep = existing.endsWith('\n') ? '\n' : '\n\n'
  writeFileSync(filePath, existing + sep + content, 'utf-8')
}

/**
 * Merge a single MCP server entry into a JSON config file, preserving every
 * other key in the file — sibling servers AND unrelated settings (e.g. Gemini's
 * `.gemini/settings.json` also holds theme/auth/model). The server map lives
 * under `serverKey`: `"mcpServers"` for most agents, `"servers"` for VS Code /
 * Copilot. A missing or unparseable file is treated as an empty config rather
 * than crashing or silently discarding the user's other configuration.
 */
export function mergeMcpServer(
  filePath: string,
  serverKey: string,
  serverName: string,
  command: { command: string; args: string[] },
): void {
  mkdirSync(dirname(filePath), { recursive: true })

  let config: Record<string, unknown> = {}
  if (existsSync(filePath)) {
    try {
      const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        config = parsed as Record<string, unknown>
      }
    } catch {
      // Corrupt / non-JSON file — start fresh rather than throw.
      config = {}
    }
  }

  const existingServers = config[serverKey]
  const servers: Record<string, unknown> =
    existingServers && typeof existingServers === 'object' && !Array.isArray(existingServers)
      ? existingServers as Record<string, unknown>
      : {}

  servers[serverName] = { command: command.command, args: command.args }
  config[serverKey] = servers

  writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
}
