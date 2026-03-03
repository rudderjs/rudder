import { Job } from '@boostkit/queue'

export class WelcomeUserJob extends Job {
  static queue   = 'default'
  static retries = 3

  constructor(
    private readonly name:  string,
    private readonly email: string,
  ) {
    super()
  }

  async handle(): Promise<void> {
    // TODO: swap for real mail when @boostkit/mail lands
    console.log(`[WelcomeUserJob] Sending welcome email to ${this.name} <${this.email}>`)
  }

  failed(error: unknown): void {
    console.error(`[WelcomeUserJob] Failed for ${this.email}:`, error)
  }
}
