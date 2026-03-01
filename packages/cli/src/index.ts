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
 * Find the nearest bootstrap/app.ts by searching up then one level down.
 * Returns the absolute path to the file, or null if not found.
 * Changes process.cwd() to the app root when found.
 */
async function resolveAppRoot(): Promise<string | null> {
  // 1. Walk up the directory tree from cwd
  let dir = process.cwd()
  while (true) {
    const candidate = path.join(dir, 'bootstrap', 'app.ts')
    try { await fs.access(candidate); process.chdir(dir); return candidate } catch {}
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  // 2. Check immediate subdirectories of cwd (monorepo: forge root → playground/)
  const entries = await fs.readdir(process.cwd(), { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const candidate = path.join(process.cwd(), entry.name, 'bootstrap', 'app.ts')
    try {
      await fs.access(candidate)
      process.chdir(path.join(process.cwd(), entry.name))
      return candidate
    } catch {}
  }

  return null
}

/**
 * Bootstrap the Forge application so providers (DB, etc.) are ready before
 * running any command.
 */
async function bootApp(): Promise<void> {
  // Suppress console during boot — provider boot messages are noise in CLI output
  const saved = {
    log: console.log, warn: console.warn,
    info: console.info, error: console.error,
  }
  const noop = (..._: unknown[]): void => {}
  console.log = console.warn = console.info = console.error = noop

  try {
    const appFile = await resolveAppRoot()
    if (appFile) {
      const { default: forge } = await import(appFile) as { default: { boot(): Promise<void> } }
      await forge.boot()
    } else {
      // Fallback: try loading console routes directly (no full app context)
      for (const ext of ['ts', 'js']) {
        const file = path.join(process.cwd(), 'routes', `console.${ext}`)
        try { await fs.access(file); await import(file); break } catch { /* skip */ }
      }
    }
  } finally {
    // Restore console so command handlers can print normally
    console.log = saved.log; console.warn = saved.warn
    console.info = saved.info; console.error = saved.error
  }
}

async function main(): Promise<void> {
  // Only show the banner for help / no-args — never for named command runs
  const rawArgs = process.argv.slice(2)
  const isHelpOrNoArgs = rawArgs.length === 0 || rawArgs.includes('--help') || rawArgs.includes('-h')
  if (isHelpOrNoArgs) await renderBanner()

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
