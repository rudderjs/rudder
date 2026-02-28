#!/usr/bin/env node
import { program } from 'commander'
import path from 'node:path'
import fs from 'node:fs/promises'
import { makeCommand } from './commands/make.js'
import { moduleCommand } from './commands/module.js'
import { artisan } from '@forge/core'

async function renderBanner(): Promise<void> {
  if (!process.stdout.isTTY) return
  try {
    const { default: cfonts } = await import('cfonts')
    const stateFile = path.join(process.cwd(), '.forge-cli-state.json')
    const pairs: [string, string][] = [
      ['cyan', 'magenta'],
      ['yellow', 'green'],
      ['blue', 'cyan'],
      ['magenta', 'red'],
    ]
    let idx = 0
    try {
      const raw = await fs.readFile(stateFile, 'utf8')
      const state = JSON.parse(raw) as { lastColorPairIndex?: number }
      idx = ((state.lastColorPairIndex ?? -1) + 1) % pairs.length
    } catch { /* ignore */ }
    cfonts.say('Forge', { font: 'block', colors: pairs[idx]!, space: false })
    fs.writeFile(stateFile, JSON.stringify({ lastColorPairIndex: idx })).catch(() => {})
  } catch { /* ignore */ }
}

/**
 * Bootstrap the Forge application so providers (DB, etc.) are ready before
 * running any command. Falls back to loading routes/console.ts directly if
 * bootstrap/app.ts doesn't exist (e.g. running CLI outside a Forge project).
 */
async function bootApp(): Promise<void> {
  const appFile = path.join(process.cwd(), 'bootstrap', 'app.ts')
  try {
    await fs.access(appFile)
    const { default: forge } = await import(appFile) as { default: { boot(): Promise<void> } }
    await forge.boot()
  } catch {
    // Not inside a Forge project — try loading console routes directly
    const consoleCandidates = [
      path.join(process.cwd(), 'routes', 'console.ts'),
      path.join(process.cwd(), 'routes', 'console.js'),
    ]
    for (const file of consoleCandidates) {
      try { await fs.access(file); await import(file); break } catch { /* skip */ }
    }
  }
}

async function main(): Promise<void> {
  await renderBanner()

  program
    .name('forge')
    .description('⚡ Forge Framework CLI')
    .version('0.0.1')

  makeCommand(program)
  moduleCommand(program)

  // Boot the app (providers + route files) so commands can use DB, etc.
  await bootApp()
  for (const cmd of artisan.getCommands()) {
    program
      .command(cmd.name)
      .description(cmd.getDescription())
      .allowUnknownOption()
      .action(async (...comArgs: unknown[]) => {
        // Commander passes parsed args then the Command instance last
        const commanderCmd = comArgs[comArgs.length - 1] as { args: string[]; opts: () => Record<string, unknown> }
        await cmd.handler(commanderCmd.args, commanderCmd.opts())
      })
  }

  program.action(() => program.help())
  program.parse()
}

main().catch(console.error)
