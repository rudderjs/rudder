import { Inngest } from 'inngest'
import { serve } from 'inngest/hono'
import type {
  Job,
  QueueAdapter,
  QueueAdapterProvider,
  DispatchOptions,
} from '@rudderjs/queue'
import { encodePayload, decodePayload, executeJob } from '@rudderjs/queue'

// ─── Config ────────────────────────────────────────────────

export interface InngestConfig {
  appId?:      string
  eventKey?:   string
  signingKey?: string
  /**
   * Job classes to register as Inngest functions.
   * Each class is mapped to a "rudderjs/job.<ClassName>" event.
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
  return `rudderjs/job.${JobClass.name}`
}

/** Inngest accepts only integer `retries` in [0, 20]. The framework's `Job.retries`
 *  is typed `number`, so user code can set 25 or -1 or `Infinity` without a
 *  compile-time signal — Inngest then rejects at registration with a confusing
 *  error. Validate + warn + clamp at the boundary.
 */
type InngestRetries = 0|1|2|3|4|5|6|7|8|9|10|11|12|13|14|15|16|17|18|19|20
function clampRetries(jobName: string, raw: unknown): InngestRetries {
  const n = Number(raw ?? 3)
  if (!Number.isInteger(n) || n < 0 || n > 20) {
    console.warn(
      `[RudderJS Queue/Inngest] retries=${String(raw)} on job "${jobName}" is invalid ` +
      `(must be integer in [0, 20]); clamping to ${Math.max(0, Math.min(20, Math.floor(Number.isFinite(n) ? n : 3)))}.`,
    )
  }
  return Math.max(0, Math.min(20, Math.floor(Number.isFinite(n) ? n : 3))) as InngestRetries
}

// ─── Inngest Adapter ───────────────────────────────────────

class InngestAdapter implements QueueAdapter {
  // Inngest serialises every event through JSON, so closure / chain / batch
  // wrappers (which carry the user's `handle` as a function property) lose
  // the handler on the wire. Surface the limitation explicitly.
  readonly supportsClosures = false
  readonly supportsChain    = false
  readonly supportsBatch    = false

  private readonly client:  Inngest
  private readonly handler: (ctx: unknown) => Promise<Response>

  constructor(config: InngestConfig) {
    this.client = new Inngest({
      id: config.appId ?? 'rudderjs-app',
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
          retries: clampRetries(JobClass.name, (JobClass as unknown as typeof Job).retries),
        },
        { event: eventName(JobClass) },
        async ({ event }) => {
          const data    = event.data as Record<string, unknown>
          const payload = data['payload'] ?? {}
          // Reconstruct the job instance from the serialized payload, then
          // hand off to `executeJob` so middleware, `failed()`, ShouldBeUnique
          // lock release, AND request-context hydration all fire — previously
          // Inngest invoked `handle()` only (Phase 1) and even after that the
          // `__context` was dropped (Phase 4).
          const decoded  = decodePayload(payload as Record<string, unknown>) as Record<string, unknown>
          const instance = Object.assign(new (JobClass as new () => Job)(), decoded)
          const ctx      = data['__context']
          await executeJob(
            instance,
            ctx && typeof ctx === 'object' ? { __context: ctx as Record<string, unknown> } : {},
          )
        },
      ),
    )

    // Build the Hono-compatible serve handler for GET + POST /api/inngest.
    // The Hono Context (c) is passed directly — it IS req.raw in the RudderJS adapter.
    this.handler = serve({
      client:    this.client,
      functions,
      ...(config.signingKey ? { signingKey: config.signingKey } : {}),
    }) as (ctx: unknown) => Promise<Response>
  }

  async dispatch(job: Job, options: DispatchOptions = {}): Promise<void> {
    const name = job.constructor.name

    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(JSON.stringify(encodePayload(job))) as Record<string, unknown>
    } catch (err) {
      throw new Error(
        `[Inngest] Cannot serialize job "${name}": ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      )
    }

    await this.client.send({
      name: eventName({ name }),
      data: {
        job:   name,
        payload,
        queue: options.queue ?? 'default',
        // Embed serialized request context (tenant/user/locale ALS via
        // `@rudderjs/context`) so the worker can rehydrate it through
        // `executeJob`. Without this, switching from BullMQ → Inngest
        // silently drops context and risks wrong-tenant DB writes.
        ...(options.__context ? { __context: options.__context } : {}),
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
