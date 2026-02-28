#!/usr/bin/env node
import { program } from 'commander'
import path from 'node:path'
import fs from 'node:fs/promises'
import { makeCommand } from './commands/make.js'
import { moduleCommand } from './commands/module.js'

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

async function main(): Promise<void> {
  await renderBanner()

  program
    .name('forge')
    .description('⚡ Forge Framework CLI')
    .version('0.0.1')

  makeCommand(program)
  moduleCommand(program)

  program.action(() => program.help())
  program.parse()
}

main().catch(console.error)
