import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { BoostAgent } from './types.js'
import { writeGuidelineBlock, mergeMcpServer } from './merge.js'

export class GeminiAgent implements BoostAgent {
  name = 'gemini'
  displayName = 'Gemini CLI'
  supportsGuidelines = true
  supportsMcp = true
  supportsSkills = false

  detect(cwd: string): boolean {
    return existsSync(join(cwd, '.gemini')) || existsSync(join(cwd, 'GEMINI.md'))
  }

  async installGuidelines(cwd: string, content: string): Promise<void> {
    writeGuidelineBlock(join(cwd, 'GEMINI.md'), content)
  }

  async installMcp(cwd: string, mcpCommand: { command: string; args: string[] }): Promise<void> {
    // .gemini/settings.json is Gemini's primary settings file (theme, auth,
    // model, …) — merge so only the mcpServers entry is touched.
    mergeMcpServer(join(cwd, '.gemini', 'settings.json'), 'mcpServers', 'rudderjs-boost', mcpCommand)
  }
}
