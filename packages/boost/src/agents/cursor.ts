import { existsSync, mkdirSync, cpSync } from 'node:fs'
import { join } from 'node:path'
import type { BoostAgent, SkillEntry } from './types.js'
import { writeGuidelineBlock, mergeMcpServer } from './merge.js'

export class CursorAgent implements BoostAgent {
  name = 'cursor'
  displayName = 'Cursor'
  supportsGuidelines = true
  supportsMcp = true
  supportsSkills = true

  detect(cwd: string): boolean {
    return existsSync(join(cwd, '.cursor')) || existsSync(join(cwd, '.cursorrules'))
  }

  async installGuidelines(cwd: string, content: string): Promise<void> {
    writeGuidelineBlock(join(cwd, '.cursorrules'), content)
  }

  async installMcp(cwd: string, mcpCommand: { command: string; args: string[] }): Promise<void> {
    mergeMcpServer(join(cwd, '.cursor', 'mcp.json'), 'mcpServers', 'rudderjs-boost', mcpCommand)
  }

  async installSkills(cwd: string, skills: SkillEntry[]): Promise<void> {
    const dir = join(cwd, '.ai', 'skills')
    mkdirSync(dir, { recursive: true })
    for (const s of skills) {
      cpSync(s.sourcePath, join(dir, s.skillName), { recursive: true })
    }
  }
}
