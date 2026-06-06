import { Job } from '@rudderjs/queue'

/**
 * Example job for the queue demo. Logs to the server terminal when run
 * by the worker. Replace with whatever async work the queue should handle
 * (sending mail, generating reports, syncing third-party data, …).
 */
export class ExampleJob extends Job {
  static override queue   = 'default'
  static override retries = 3

  constructor(private readonly payload: string = 'hello') {
    super()
  }

  async handle(): Promise<void> {
    console.log(`[ExampleJob] handling: ${this.payload}`)
  }

  failed(error: unknown): void {
    console.error('[ExampleJob] failed after all retries:', error)
  }
}
