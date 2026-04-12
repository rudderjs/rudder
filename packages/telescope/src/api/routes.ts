import type { AppRequest, AppResponse, MiddlewareHandler } from '@rudderjs/contracts'
import type { TelescopeStorage, TelescopeConfig, EntryType } from '../types.js'

const ENTRY_TYPES: EntryType[] = [
  'request', 'query', 'job', 'exception', 'log',
  'mail', 'notification', 'event', 'cache', 'schedule', 'model',
]

// ─── Handlers ──────────────────────────────────────────────
//
// Pure handler functions invoked from `../routes.ts`. Kept separate from
// route registration so they can be reused or unit-tested without spinning
// up a router.

export async function listEntries(
  storage: TelescopeStorage,
  type:    EntryType,
  req:     AppRequest,
  res:     AppResponse,
): Promise<void> {
  const page    = parseInt(req.query['page']     ?? '1', 10)
  const perPage = parseInt(req.query['per_page'] ?? '50', 10)
  const tag     = req.query['tag']
  const search  = req.query['search']
  const batchId = req.query['batch_id']

  const entries = await storage.list({ type, page, perPage, tag, search, batchId })
  const total   = await storage.count(type)

  res.json({
    data: entries,
    meta: {
      total,
      page,
      per_page: perPage,
      last_page: Math.ceil(total / perPage),
    },
  })
}

export async function showEntry(
  storage: TelescopeStorage,
  req:     AppRequest,
  res:     AppResponse,
): Promise<void> {
  const entry = await storage.find(req.params['id'] ?? '')
  if (!entry) {
    res.status(404).json({ message: 'Entry not found.' })
    return
  }

  // If this entry has a batchId, include related entries
  let related: unknown[] = []
  if (entry.batchId) {
    related = await storage.list({ batchId: entry.batchId, perPage: 100 })
  }

  res.json({ data: entry, related })
}

export async function listBatch(
  storage: TelescopeStorage,
  req:     AppRequest,
  res:     AppResponse,
): Promise<void> {
  const batchId = req.params['batchId'] ?? ''
  const entries = await storage.list({ batchId, perPage: 500 })
  res.json({ data: entries })
}

export async function overview(
  storage: TelescopeStorage,
  res:     AppResponse,
): Promise<void> {
  const counts: Record<string, number> = {}
  for (const type of ENTRY_TYPES) {
    counts[type] = await storage.count(type)
  }
  res.json({ counts, total: await storage.count() })
}

export async function prune(
  storage: TelescopeStorage,
  req:     AppRequest,
  res:     AppResponse,
): Promise<void> {
  const type = req.query['type'] as EntryType | undefined
  if (type && ENTRY_TYPES.includes(type)) {
    await storage.prune(type)
  } else {
    await storage.prune()
  }
  res.json({ message: 'Entries pruned.' })
}

// ─── Auth Middleware ───────────────────────────────────────

export function authMiddleware(config: Pick<TelescopeConfig, 'auth'>): MiddlewareHandler {
  return async (req, res, next) => {
    if (config.auth) {
      const allowed = await config.auth(req)
      if (!allowed) {
        res.status(403).json({ message: 'Unauthorized.' })
        return
      }
    }
    return next()
  }
}
