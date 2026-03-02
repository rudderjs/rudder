import { Inngest } from 'inngest'
import { serve } from 'inngest/hono'
import type {
  Job,
  QueueAdapter,
  QueueAdapterProvider,
  DispatchOptions,
} from '@forge/queue'

// ─── Config ────────────────────────────────────────────────

export interface InngestConfig {
  appId?:      string
  eventKey?:   string
  signingKey?: string
  /**
   * Job classes to register as Inngest functions.
   * Each class is mapped to a "forge/job.<ClassName>" event.
   *
   * @example
   *   jobs: [WelcomeUserJob, ProcessOrderJob]
   */
  jobs?: (new (...args: never[]) => Job)[]
  [key: string]: unknown
}

// ─── Helpers ───────────────────────────────────────────────

/** Derives the Inngest event name from a Job class */
function eventName(JobClass: { name: string }): string {
  return `forge/job.${JobClass.name}`
}

// ─── Inngest Adapter ───────────────────────────────────────

class InngestAdapter implements QueueAdapter {
  private readonly client:  Inngest
  private readonly handler: (ctx: unknown) => Promise<Response>

  constructor(config: InngestConfig) {
    this.client = new Inngest({
      id: config.appId ?? 'forge-app',
      ...(config.eventKey ? { eventKey: config.eventKey } : {}),
    })

    // Register each job class as an Inngest function.
    // When Inngest calls the serve endpoint for an event, it reconstructs
    // the job from the serialized payload and calls handle().
    const functions = (config.jobs ?? []).map((JobClass) =>
      this.client.createFunction(
        {
          id:      JobClass.name,
          name:    JobClass.name,
          retries: ((JobClass as unknown as typeof Job).retries ?? 3) as 0|1|2|3|4|5|6|7|8|9|10|11|12|13|14|15|16|17|18|19|20,
        },
        { event: eventName(JobClass) },
        async ({ event }) => {
          const payload = (event.data as Record<string, unknown>)['payload'] ?? {}
          // Reconstruct the job instance from the serialized payload.
          // TypeScript `private` fields are plain JS properties at runtime,
          // so Object.assign correctly restores them.
          const job = Object.assign(
            new (JobClass as new () => Job)(),
            payload,
          )
          await job.handle()
        },
      ),
    )

    // Build the Hono-compatible serve handler for GET + POST /api/inngest.
    // The Hono Context (c) is passed directly — it IS req.raw in the Forge adapter.
    this.handler = serve({
      client:    this.client,
      functions,
      ...(config.signingKey ? { signingKey: config.signingKey } : {}),
    }) as (ctx: unknown) => Promise<Response>
  }

  async dispatch(job: Job, options: DispatchOptions = {}): Promise<void> {
    const name = job.constructor.name

    await this.client.send({
      name: eventName({ name }),
      data: {
        job:     name,
        payload: JSON.parse(JSON.stringify(job)),
        queue:   options.queue ?? 'default',
      },
      ...(options.delay ? { ts: Date.now() + options.delay } : {}),
    })
  }

  serveHandler(): (ctx: unknown) => Promise<Response> {
    return this.handler
  }
}

// ─── Factory ───────────────────────────────────────────────

export function inngest(config: InngestConfig = {}): QueueAdapterProvider {
  return {
    create(): QueueAdapter {
      return new InngestAdapter(config)
    },
  }
}
