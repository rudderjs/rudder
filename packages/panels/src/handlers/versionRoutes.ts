import type { MiddlewareHandler, AppRequest, AppResponse } from '@boostkit/core'
import type { RouterLike } from './types.js'
import type { Panel } from '../Panel.js'
import type { Resource } from '../Resource.js'
import type { ModelClass, RecordRow } from '../types.js'
import { flattenFields, buildContext, coercePayload, liveBroadcast } from './utils.js'

/** Extract a named route parameter — always returns a string (empty if somehow absent). */
function param(req: AppRequest, name: string): string {
  return (req.params as Record<string, string | undefined>)[name] ?? ''
}

// ── Minimal structural types for dynamically-resolved dependencies ──

interface PrismaVersionClient {
  panelVersion: {
    findMany(args: {
      where: Record<string, unknown>
      orderBy: Record<string, unknown>
      select: Record<string, boolean>
    }): Promise<Array<Record<string, unknown>>>
    create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>
    findUnique(args: { where: Record<string, unknown> }): Promise<Record<string, unknown> | null>
  }
}

export function mountVersionRoutes(
  router: RouterLike,
  panel: Panel,
  ResourceClass: typeof Resource,
  mw: MiddlewareHandler[],
): void {
  const slug     = ResourceClass.getSlug()
  const base     = `${panel.getApiBase()}/${slug}`
  const versionResource = new ResourceClass()
  const isCollab = flattenFields(versionResource._resolveForm().getFields() as import('../Resource.js').FieldOrGrouping[]).some(f => f.isYjs())

  // GET /{panel}/api/{resource}/{id}/_versions — list
  router.get(`${base}/:id/_versions`, async (req: AppRequest, res: AppResponse) => {
    const id = param(req, 'id')
    const docName = `panel:${slug}:${id}`
    try {
      const { app } = await import(/* @vite-ignore */ '@boostkit/core') as { app(): { make(k: string): unknown } }
      const prisma = app().make('prisma') as PrismaVersionClient
      const versions = await prisma.panelVersion.findMany({
        where: { docName },
        orderBy: { createdAt: 'desc' },
        select: { id: true, label: true, userId: true, createdAt: true },
      })
      return res.json({ data: versions })
    } catch {
      return res.json({ data: [] })
    }
  }, mw)

  // POST /{panel}/api/{resource}/{id}/_versions — create snapshot
  // With collaborative: reads from Y.Doc (live state)
  // Without collaborative: reads from request body or current DB record
  router.post(`${base}/:id/_versions`, async (req: AppRequest, res: AppResponse) => {
    const resource = new ResourceClass()
    const ctx = buildContext(req)
    if (!await resource.policy('update', ctx)) return res.status(403).json({ message: 'Forbidden.' })

    const Model = ResourceClass.model as ModelClass<RecordRow> | undefined
    if (!Model) return res.status(500).json({ message: 'No model.' })

    const id      = param(req, 'id')
    const docName = `panel:${slug}:${id}`
    const body    = req.body as { label?: string; fields?: Record<string, unknown>; draftStatus?: string }

    try {
      const { app } = await import(/* @vite-ignore */ '@boostkit/core') as { app(): { make(k: string): unknown } }
      const prisma = app().make('prisma') as PrismaVersionClient

      let fieldValues: Record<string, unknown>

      if (body.fields) {
        // Explicit fields in body — used by both collaborative and non-collaborative
        fieldValues = body.fields
      } else if (isCollab) {
        // Collaborative: read from Y.Doc
        try {
          const { Live } = await import(/* @vite-ignore */ '@boostkit/live')
          fieldValues = Live.readMap(docName, 'fields')
        } catch {
          // Y.Doc not available — fall back to DB record
          const record = await Model.find(id)
          fieldValues = record ? { ...(record as Record<string, unknown>) } : {}
          delete fieldValues['id']; delete fieldValues['createdAt']; delete fieldValues['updatedAt']
        }
      } else {
        // Non-collaborative: snapshot from current DB record
        const record = await Model.find(id)
        fieldValues = record ? { ...(record as Record<string, unknown>) } : {}
        delete fieldValues['id']; delete fieldValues['createdAt']; delete fieldValues['updatedAt']
      }

      // Store version as JSON snapshot
      await prisma.panelVersion.create({
        data: {
          docName,
          snapshot: Buffer.from(JSON.stringify(fieldValues)),
          label:    body.label ?? null,
           
          userId:   ctx.user?.id ?? null,
        },
      })

      // Write field values to DB (publish)
      const coerced = coercePayload(resource, fieldValues, 'update')

      // Handle draftable: set _status if provided
      const vFormMeta = new ResourceClass()._resolveForm().toMeta()
      if (vFormMeta.draftable && body.draftStatus) {
        coerced['draftStatus'] = body.draftStatus
      }

      await Model.query().update(id, coerced)

      const vTableConfig = Model ? new ResourceClass()._resolveTable().getConfig() : undefined
      if (vTableConfig?.live) liveBroadcast(slug, 'record.updated', { id })

      return res.json({ message: 'Version saved and published.' })
    } catch (err) {
      return res.status(500).json({ message: 'Failed to save version.', error: String(err) })
    }
  }, mw)

  // POST /{panel}/api/{resource}/{id}/_sync-live — clear Y.Docs and re-seed with saved values
  router.post(`${base}/:id/_sync-live`, async (req: AppRequest, res: AppResponse) => {
    if (!isCollab) return res.json({ message: 'Not collaborative.' })
    const id = param(req, 'id')
    const docName = `panel:${slug}:${id}`

    try {
      const { Live } = await import(/* @vite-ignore */ '@boostkit/live')

      const resource = new ResourceClass()
      const vFormFields = flattenFields(resource._resolveForm().getFields() as import('../Resource.js').FieldOrGrouping[])
      const collabFields = vFormFields.filter(f => f.isYjs())

      const fieldDocNames = collabFields.map(f => {
        const type = f.getType()
        const name = f.getName()
        const prefix = (type === 'richcontent' || type === 'content') ? type : 'text'
        return `${docName}:${prefix}:${name}`
      })

      // Clear all Y.Doc rooms (main + per-field)
      await Live.clearDocument(docName)
      for (const name of fieldDocNames) await Live.clearDocument(name)

      // y-websocket auto-reconnects and re-pushes stale data — clear again after delays
      // to catch reconnection at different exponential backoff intervals (100ms, 200ms, 400ms...)
      for (const delay of [300, 1000, 3000]) {
        setTimeout(async () => {
          try {
            for (const name of fieldDocNames) await Live.clearDocument(name)
            await Live.clearDocument(docName)
          } catch { /* ignore */ }
        }, delay)
      }

      // Re-seed the main Y.Doc with saved DB values
      const SyncModel = ResourceClass.model as ModelClass<RecordRow> | undefined
      if (SyncModel) {
        const record = await SyncModel.find(id)
        if (record) {
          const fieldData: Record<string, unknown> = {}
          for (const f of vFormFields) {
            const name = f.getName()
            if (name in record) {
              fieldData[name] = record[name]
            }
          }
          await Live.seed(docName, fieldData)
        }
      }

      // Broadcast to all clients so they remount editors with fresh Y.Docs
      liveBroadcast(slug, 'version.restored', { id })

      return res.json({ message: 'Live documents synced.' })
    } catch {
      return res.json({ message: 'No live provider — skipped.' })
    }
  }, mw)


  // GET /{panel}/api/{resource}/{id}/_versions/{versionId} — detail
  router.get(`${base}/:id/_versions/:versionId`, async (req: AppRequest, res: AppResponse) => {
    const versionId = param(req, 'versionId')
    try {
      const { app } = await import(/* @vite-ignore */ '@boostkit/core') as { app(): { make(k: string): unknown } }
      const prisma = app().make('prisma') as PrismaVersionClient
      const version = await prisma.panelVersion.findUnique({ where: { id: versionId } })
      if (!version) return res.status(404).json({ message: 'Version not found.' })

      let data: Record<string, unknown>

      // Try JSON first (non-collaborative snapshots)
      try {
        data = JSON.parse(Buffer.from(version['snapshot'] as Buffer).toString('utf8'))
      } catch {
        // Fall back to Y.Doc binary (collaborative snapshots)
        // yjs is an optional peer dep (not installed in panels); resolve via string variable
        const yjsId = 'yjs'
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const Y = await import(/* @vite-ignore */ yjsId) as any
        const doc = new Y.Doc()
        Y.applyUpdate(doc, new Uint8Array(version['snapshot'] as Buffer))
        const fields = doc.getMap('fields')
        data = {}
        fields.forEach((val: unknown, key: string) => { data[key] = val })
        doc.destroy()
      }

      return res.json({
        data: {
          id:        version['id'],
          label:     version['label'],
          userId:    version['userId'],
          createdAt: version['createdAt'],
          fields:    data,
        },
      })
    } catch (err) {
      return res.status(500).json({ message: 'Failed to read version.', error: String(err) })
    }
  }, mw)
}
