import type { Command } from 'commander'
import chalk from 'chalk'
import { getMakeSpecs, executeMakeSpec } from '@rudderjs/rudder'
import { makeController } from './make/controller.js'
import { makeModel } from './make/model.js'
import { makeJob } from './make/job.js'
import { makeMiddleware } from './make/middleware.js'
import { makeRequest } from './make/request.js'
import { makeProvider } from './make/provider.js'
import { makeCommandCmd } from './make/command.js'
import { makeEvent } from './make/event.js'
import { makeListener } from './make/listener.js'
import { makeMail } from './make/mail.js'

export function makeCommand(program: Command): void {
  // CLI-owned generic scaffolders
  makeController(program)
  makeModel(program)
  makeJob(program)
  makeMiddleware(program)
  makeRequest(program)
  makeProvider(program)
  makeCommandCmd(program)
  makeEvent(program)
  makeListener(program)
  makeMail(program)

  // Package-contributed scaffolders (registered via registerMakeSpecs)
  for (const spec of getMakeSpecs()) {
    program
      .command(`${spec.command} <name>`)
      .description(spec.description)
      .option('-f, --force', 'Overwrite if file already exists')
      .action(async (name: string, opts: { force?: boolean }) => {
        const result = await executeMakeSpec(spec, name, opts)
        if (!result.created) {
          console.error(chalk.red(`  ✗ Already exists: ${result.relPath}`))
          console.error(chalk.dim('    Use --force to overwrite.'))
          return
        }
        console.log(chalk.green(`  ✔ ${spec.label}:`), chalk.cyan(result.relPath))
      })
  }
}
