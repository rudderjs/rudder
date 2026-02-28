import type { Command } from 'commander'
import { makeModule } from './module/make.js'
import { publishModule } from './module/publish.js'

export function moduleCommand(program: Command): void {
  makeModule(program)
  publishModule(program)
}
