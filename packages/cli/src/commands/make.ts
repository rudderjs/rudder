import type { Command } from 'commander'
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
}
