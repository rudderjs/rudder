import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { BoostAgent } from './types.js'
import { writeGuidelineBlock, mergeMcpServer } from './merge.js'

export class CopilotAgent implements BoostAgent {
  name = 'copilot'
  displayName = 'GitHub Copilot'
  supportsGuidelines = true
  supportsMcp = true
  supportsSkills = false

  detect(cwd: string): boolean {
    return existsSync(join(cwd, '.github', 'copilot-instructions.md')) || existsSync(join(cwd, '.vscode'))
  }

  async installGuidelines(cwd: string, content: string): Promise<void> {
    writeGuidelineBlock(join(cwd, '.github', 'copilot-instructions.md'), content)
  }

  async installMcp(cwd: string, mcpCommand: { command: string; args: string[] }): Promise<void> {
    // VS Code uses the `servers` key (not `mcpServers`).
    mergeMcpServer(join(cwd, '.vscode', 'mcp.json'), 'servers', 'rudderjs-boost', mcpCommand)
  }
}
