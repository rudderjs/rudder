import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { BoostAgent } from './types.js'
import { writeGuidelineBlock, mergeMcpServer } from './merge.js'

export class WindsurfAgent implements BoostAgent {
  name = 'windsurf'
  displayName = 'Windsurf'
  supportsGuidelines = true
  supportsMcp = true
  supportsSkills = false

  detect(cwd: string): boolean {
    return existsSync(join(cwd, '.windsurf')) || existsSync(join(cwd, '.windsurfrules'))
  }

  async installGuidelines(cwd: string, content: string): Promise<void> {
    writeGuidelineBlock(join(cwd, '.windsurfrules'), content)
  }

  async installMcp(cwd: string, mcpCommand: { command: string; args: string[] }): Promise<void> {
    mergeMcpServer(join(cwd, '.windsurf', 'mcp.json'), 'mcpServers', 'rudderjs-boost', mcpCommand)
  }
}
