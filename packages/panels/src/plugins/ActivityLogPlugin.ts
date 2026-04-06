import type { PanelPlugin } from '../Panel.js'
import type { Panel } from '../Panel.js'
import type { AppRequest, AppResponse, MiddlewareHandler } from '@rudderjs/core'

/* eslint-disable @typescript-eslint/no-explicit-any */

// ─── Activity record interface ────────────────────────────

export interface ActivityRecord {
  id:           string
  resourceSlug: string
  recordId:     string
  action:       'created' | 'updated' | 'deleted' | 'restored'
  userId?:      string
  userName?:    string
  changes?:     Record<string, { old: unknown; new: unknown }>
  createdAt:    Date
}

// ─── Activity store interface ─────────────────────────────

export interface ActivityStoreLike {
  log(entry: Omit<ActivityRecord, 'id' | 'createdAt'>): Promise<void>
  list(resourceSlug: string, recordId: string, opts?: { limit?: number; offset?: number }): Promise<ActivityRecord[]>
  listForResource(resourceSlug: string, opts?: { limit?: number }): Promise<ActivityRecord[]>
}

// ─── Plugin config ────────────────────────────────────────

export interface ActivityLogConfig {
  /** Custom activity store (defaults to resolving 'activity.store' from DI). */
  store?: ActivityStoreLike
  /** Track field-level changes (diff old vs new values). Default: true. */
  trackChanges?: boolean
}

// ─── Plugin factory ───────────────────────────────────────

/**
 * Activity log plugin — records who changed what on each resource.
 *
 * @example
 * Panel.make('admin')
 *   .use(activityLog())
 *   .use(activityLog({ trackChanges: true }))
 */
export function activityLog(config: ActivityLogConfig = {}): PanelPlugin {
  const trackChanges = config.trackChanges !== false

  let store: ActivityStoreLike | null = config.store ?? null

  async function resolveStore(app: any): Promise<ActivityStoreLike | null> {
    if (store) return store
    try {
      store = app.make('activity.store') as ActivityStoreLike
      return store
    } catch { return null }
  }

  return {
    register(_panel: Panel, app: any) {
      // Bind a default in-memory store if none exists
      try {
        app.make('activity.store')
      } catch {
        app.bind('activity.store', () => createInMemoryStore())
      }
    },

    async boot(panel: Panel, app: any) {
      const resolvedStore = await resolveStore(app)
      if (!resolvedStore) return

      // Mount activity routes for each resource
      try {
        const router = app.make('router') as {
          get(path: string, handler: (req: AppRequest, res: AppResponse) => unknown, mw?: MiddlewareHandler[]): void
        }

        for (const ResourceClass of panel.getResources()) {
          const slug = ResourceClass.getSlug()
          const base = `${panel.getApiBase()}/${slug}`

          // GET /panel/api/{resource}/:id/_activity
          router.get(`${base}/:id/_activity`, async (req: AppRequest, res: AppResponse) => {
            const id = (req.params as Record<string, string | undefined>)['id'] ?? ''
            const url = new URL(req.url, 'http://localhost')
            const limit = Number(url.searchParams.get('limit') ?? 20)
            const offset = Number(url.searchParams.get('offset') ?? 0)

            const entries = await resolvedStore.list(slug, id, { limit, offset })
            return res.json({ data: entries })
          })

          // GET /panel/api/{resource}/_activity (resource-level feed)
          router.get(`${base}/_activity`, async (req: AppRequest, res: AppResponse) => {
            const url = new URL(req.url, 'http://localhost')
            const limit = Number(url.searchParams.get('limit') ?? 50)

            const entries = await resolvedStore.listForResource(slug, { limit })
            return res.json({ data: entries })
          })
        }
      } catch { /* router not available */ }
    },
  }
}

// ─── Default in-memory store (for dev/testing) ────────────

function createInMemoryStore(): ActivityStoreLike {
  const entries: ActivityRecord[] = []
  let nextId = 1

  return {
    async log(entry) {
      entries.unshift({
        ...entry,
        id: String(nextId++),
        createdAt: new Date(),
      })
      // Keep max 10k entries
      if (entries.length > 10000) entries.length = 10000
    },

    async list(resourceSlug, recordId, opts) {
      const limit = opts?.limit ?? 20
      const offset = opts?.offset ?? 0
      return entries
        .filter(e => e.resourceSlug === resourceSlug && e.recordId === recordId)
        .slice(offset, offset + limit)
    },

    async listForResource(resourceSlug, opts) {
      const limit = opts?.limit ?? 50
      return entries
        .filter(e => e.resourceSlug === resourceSlug)
        .slice(0, limit)
    },
  }
}

// ─── Helper to log activity from handlers ─────────────────

/**
 * Log an activity entry. Call this from CRUD handlers after mutations.
 *
 * @example
 * import { logActivity } from '@rudderjs/panels/plugins/ActivityLogPlugin'
 * await logActivity('posts', recordId, 'updated', { userId, changes })
 */
export async function logActivity(
  resourceSlug: string,
  recordId: string,
  action: ActivityRecord['action'],
  opts?: {
    userId?: string
    userName?: string
    changes?: Record<string, { old: unknown; new: unknown }>
  },
): Promise<void> {
  try {
    const { app } = await import(/* @vite-ignore */ '@rudderjs/core') as { app(): { make(k: string): unknown } }
    const store = app().make('activity.store') as ActivityStoreLike
    const entry: Omit<ActivityRecord, 'id' | 'createdAt'> = {
      resourceSlug,
      recordId,
      action,
    }
    if (opts?.userId) entry.userId = opts.userId
    if (opts?.userName) entry.userName = opts.userName
    if (opts?.changes) entry.changes = opts.changes
    await store.log(entry)
  } catch { /* activity store not registered — skip silently */ }
}

/* eslint-enable @typescript-eslint/no-explicit-any */
