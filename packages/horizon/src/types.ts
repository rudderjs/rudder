// ─── Job Record ────────────────────────────────────────────

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed'

export interface HorizonJob {
  id:           string
  name:         string
  queue:        string
  status:       JobStatus
  payload:      Record<string, unknown>
  attempts:     number
  exception:    string | null
  dispatchedAt: Date
  startedAt:    Date | null
  completedAt:  Date | null
  duration:     number | null  // ms from start to completion
  tags:         string[]
}

// ─── Queue Metrics ─────────────────────────────────────────

export interface QueueMetric {
  queue:       string
  throughput:  number   // jobs/min in current bucket
  waitTime:    number   // avg ms from dispatch to start
  runtime:     number   // avg ms processing duration
  pending:     number
  active:      number
  completed:   number
  failed:      number
}

// ─── Worker Status ─────────────────────────────────────────

export interface WorkerInfo {
  id:        string
  queue:     string
  status:    'active' | 'idle' | 'paused'
  jobsRun:   number
  memoryMb:  number
  startedAt: Date
  lastJobAt: Date | null
}

// ─── Storage Contract ──────────────────────────────────────

export interface HorizonStorage {
  /** Record a job event (dispatch, start, complete, fail) */
  recordJob(job: HorizonJob): void | Promise<void>
  /** Update an existing job record */
  updateJob(id: string, updates: Partial<HorizonJob>): void | Promise<void>

  /** List recent jobs */
  recentJobs(options?: JobListOptions): HorizonJob[] | Promise<HorizonJob[]>
  /** List failed jobs */
  failedJobs(options?: JobListOptions): HorizonJob[] | Promise<HorizonJob[]>
  /** Get a single job by ID */
  findJob(id: string): HorizonJob | null | Promise<HorizonJob | null>

  /** Record a per-minute metric snapshot for a queue */
  recordMetric(metric: QueueMetric): void | Promise<void>
  /** Get metric history for a queue */
  metrics(queue: string, since: Date): QueueMetric[] | Promise<QueueMetric[]>
  /** Get latest metric for each queue */
  currentMetrics(): QueueMetric[] | Promise<QueueMetric[]>

  /** Register/update a worker */
  recordWorker(worker: WorkerInfo): void | Promise<void>
  /** List all known workers */
  workers(): WorkerInfo[] | Promise<WorkerInfo[]>

  /** Delete a failed job record */
  deleteJob(id: string): void | Promise<void>
  /** Delete all data older than date */
  pruneOlderThan(date: Date): void | Promise<void>

  /** Count jobs by status */
  jobCount(status?: JobStatus | undefined): number | Promise<number>
}

export interface JobListOptions {
  page?:    number | undefined
  perPage?: number | undefined
  queue?:   string | undefined
  search?:  string | undefined
  status?:  JobStatus | undefined
}

// ─── Config ────────────────────────────────────────────────

export interface HorizonConfig {
  enabled?:           boolean | undefined
  path?:              string | undefined
  storage?:           'memory' | 'sqlite' | undefined
  sqlitePath?:        string | undefined
  maxJobs?:           number | undefined
  pruneAfterHours?:   number | undefined
  metricsIntervalMs?: number | undefined
  auth?:              null | ((req: unknown) => boolean | Promise<boolean>) | undefined
}

export const defaultConfig = {
  enabled:           true,
  path:              'horizon',
  storage:           'memory' as const,
  sqlitePath:        '.horizon.db',
  maxJobs:           1000,
  pruneAfterHours:   72,
  metricsIntervalMs: 60_000,
  auth:              null as null | ((req: unknown) => boolean | Promise<boolean>),
}
