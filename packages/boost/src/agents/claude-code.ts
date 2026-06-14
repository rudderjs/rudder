import { existsSync, mkdirSync, cpSync } from 'node:fs'
import { join } from 'node:path'
import type { BoostAgent, SkillEntry } from './types.js'
import { writeGuidelineBlock, mergeMcpServer } from './merge.js'

export class ClaudeCodeAgent implements BoostAgent {
  name = 'claude-code'
  displayName = 'Claude Code'
  supportsGuidelines = true
  supportsMcp = true
  supportsSkills = true

  detect(cwd: string): boolean {
    return existsSync(join(cwd, '.mcp.json')) || existsSync(join(cwd, 'CLAUDE.md'))
  }

  async installGuidelines(cwd: string, content: string): Promise<void> {
    writeGuidelineBlock(join(cwd, 'CLAUDE.md'), content)
  }

  async installMcp(cwd: string, mcpCommand: { command: string; args: string[] }): Promise<void> {
    mergeMcpServer(join(cwd, '.mcp.json'), 'mcpServers', 'rudderjs-boost', mcpCommand)
  }

  async installSkills(cwd: string, skills: SkillEntry[]): Promise<void> {
    const dir = join(cwd, '.ai', 'skills')
    mkdirSync(dir, { recursive: true })
    for (const s of skills) {
      cpSync(s.sourcePath, join(dir, s.skillName), { recursive: true })
    }
  }
}
