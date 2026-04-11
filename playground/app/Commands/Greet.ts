import { Command } from '@rudderjs/rudder'

export class Greet extends Command {
  readonly signature   = 'greet {name : Person to greet} {--shout : Uppercase output} {--lang=en : Language code}'
  readonly description = 'Print a greeting'

  async handle(): Promise<void> {
    this.info('Running Greet...')

    const force = this.option('force')
    if (force) this.comment('  Force flag is set')

    // TODO: implement

    this.info('Done.')
  }
}
