import { Command } from '@forge/core'

export class SendEmails extends Command {
  readonly signature   = 'mail:send {--force : Skip confirmation}'
  readonly description = 'Send a marketing email to a user'

  async handle(): Promise<void> {
    const email = await this.ask('What is the recipient email?', 'user@example.com')
    const type  = await this.choice('Email type', ['welcome', 'newsletter', 'promo'])

    const force = this.option('force')
    if (!force) {
      const ok = await this.confirm(`Send "${type}" email to ${email}?`)
      if (!ok) { this.warn('Aborted.'); return }
    }

    this.info(`Sending "${type}" email to ${email}...`)
    // TODO: implement mailer

    this.info('Done.')
  }
}
