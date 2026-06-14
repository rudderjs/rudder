import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { BoostAgent } from './types.js'
import { writeGuidelineBlock, mergeMcpServer } from './merge.js'

export class CodexAgent implements BoostAgent {
  name = 'codex'
  displayName = 'Codex CLI'
  supportsGuidelines = true
  supportsMcp = true
  supportsSkills = false

  detect(cwd: string): boolean {
    return existsSync(join(cwd, 'AGENTS.md'))
  }

  async installGuidelines(cwd: string, content: string): Promise<void> {
    writeGuidelineBlock(join(cwd, 'AGENTS.md'), content)
  }

  async installMcp(cwd: string, mcpCommand: { command: string; args: string[] }): Promise<void> {
    // Codex shares the .mcp.json format (and file) with Claude Code — merging
    // keeps both servers when a project enables both agents.
    mergeMcpServer(join(cwd, '.mcp.json'), 'mcpServers', 'rudderjs-boost', mcpCommand)
  }
}
