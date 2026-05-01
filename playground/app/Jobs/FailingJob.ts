import { Job } from '@rudderjs/queue'

/**
 * Always-failing job — used by the `/test/horizon` route to populate
 * Horizon's "Failed Jobs" page. Throws on every attempt; the queue
 * worker records it as failed after exhausting retries.
 */
export class FailingJob extends Job {
  static queue   = 'default'
  static retries = 1

  constructor(private readonly reason: string = 'Intentional test failure') {
    super()
  }

  async handle(): Promise<void> {
    throw new Error(this.reason)
  }
}
