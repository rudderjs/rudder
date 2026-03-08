import { ServiceProvider } from '@boostkit/core'
import type { MiddlewareHandler, AppRequest, AppResponse } from '@boostkit/core'
import { PanelRegistry } from './PanelRegistry.js'
import type { Panel } from './Panel.js'
import type { Resource } from './Resource.js'
import type { Action } from './Action.js'
import type { PanelContext } from './types.js'

// ─── Panel Service Provider ────────────────────────────────

export class PanelServiceProvider extends ServiceProvider {
  register(): void {}

  async boot(): Promise<void> {
    const { router } = await import('@boostkit/router') as {
      router: {
        get(path: string, handler: (req: AppRequest, res: AppResponse) => unknown, mw?: MiddlewareHandler[]): void
        post(path: string, handler: (req: AppRequest, res: AppResponse) => unknown, mw?: MiddlewareHandler[]): void
        put(path: string, handler: (req: AppRequest, res: AppResponse) => unknown, mw?: MiddlewareHandler[]): void
        delete(path: string, handler: (req: AppRequest, res: AppResponse) => unknown, mw?: MiddlewareHandler[]): void
      }
    }

    for (const panel of PanelRegistry.all()) {
      const mw = this.buildPanelMiddleware(panel)

      // Meta endpoint — returns panel structure for UI consumers
      router.get(`${panel.getApiBase()}/_meta`, (_req, res) => {
        return res.json(panel.toMeta())
      }, mw)

      // Mount CRUD routes for each resource
      for (const ResourceClass of panel.getResources()) {
        this.mountResource(router, panel, ResourceClass, mw)
      }
    }
  }

  // ── Guard middleware ───────────────────────────────────

  private buildPanelMiddleware(panel: Panel): MiddlewareHandler[] {
    const guard = panel.getGuard()
    if (!guard) return []

    const mw: MiddlewareHandler = async (req, res, next) => {
      const ctx: PanelContext = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        user:    (req as any).user,
        headers: req.headers as Record<string, string>,
        path:    req.path,
      }
      const allowed = await guard(ctx)
      if (!allowed) {
        return res.status(401).json({ message: 'Unauthorized.' })
      }
      await next()
    }

    return [mw]
  }

  // ── Resource CRUD routes ───────────────────────────────

  private mountResource(
    router: {
      get(path: string, handler: (req: AppRequest, res: AppResponse) => unknown, mw?: MiddlewareHandler[]): void
      post(path: string, handler: (req: AppRequest, res: AppResponse) => unknown, mw?: MiddlewareHandler[]): void
      put(path: string, handler: (req: AppRequest, res: AppResponse) => unknown, mw?: MiddlewareHandler[]): void
      delete(path: string, handler: (req: AppRequest, res: AppResponse) => unknown, mw?: MiddlewareHandler[]): void
    },
    panel: Panel,
    ResourceClass: typeof Resource,
    mw: MiddlewareHandler[],
  ): void {
    const slug    = ResourceClass.getSlug()
    const base    = `${panel.getApiBase()}/${slug}`
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Model   = ResourceClass.model as any

    // ── GET /panel/api/resource — list (paginated) ────────
    router.get(base, async (req, res) => {
      const resource = new ResourceClass()
      const ctx      = this.buildContext(req)
      if (!await resource.policy('viewAny', ctx)) return res.status(403).json({ message: 'Forbidden.' })
      if (!Model) return res.status(500).json({ message: `Resource "${slug}" has no model defined.` })

      const page    = Number((req.query as Record<string, string>)['page']    ?? 1)
      const perPage = Number((req.query as Record<string, string>)['perPage'] ?? 15)
      const result  = await Model.paginate(page, perPage)

      return res.json({
        data: result.data,
        meta: {
          total:       result.total,
          currentPage: result.currentPage,
          perPage:     result.perPage,
          lastPage:    result.lastPage,
        },
      })
    }, mw)

    // ── GET /panel/api/resource/:id — show ────────────────
    router.get(`${base}/:id`, async (req, res) => {
      const resource = new ResourceClass()
      const ctx      = this.buildContext(req)
      if (!await resource.policy('view', ctx)) return res.status(403).json({ message: 'Forbidden.' })
      if (!Model) return res.status(500).json({ message: `Resource "${slug}" has no model defined.` })

      const id     = (req.params as Record<string, string>)['id']
      const record = await Model.find(id)
      if (!record) return res.status(404).json({ message: 'Record not found.' })

      return res.json({ data: record })
    }, mw)

    // ── POST /panel/api/resource — create ─────────────────
    router.post(base, async (req, res) => {
      const resource = new ResourceClass()
      const ctx      = this.buildContext(req)
      if (!await resource.policy('create', ctx)) return res.status(403).json({ message: 'Forbidden.' })
      if (!Model) return res.status(500).json({ message: `Resource "${slug}" has no model defined.` })

      const body   = req.body as Record<string, unknown>
      const errors = this.validatePayload(resource, body, 'create')
      if (errors) return res.status(422).json({ message: 'Validation failed.', errors })

      const record = await Model.create(body)
      return res.status(201).json({ data: record })
    }, mw)

    // ── PUT /panel/api/resource/:id — update ──────────────
    router.put(`${base}/:id`, async (req, res) => {
      const resource = new ResourceClass()
      const ctx      = this.buildContext(req)
      if (!await resource.policy('update', ctx)) return res.status(403).json({ message: 'Forbidden.' })
      if (!Model) return res.status(500).json({ message: `Resource "${slug}" has no model defined.` })

      const id     = (req.params as Record<string, string>)['id']
      const exists = await Model.find(id)
      if (!exists) return res.status(404).json({ message: 'Record not found.' })

      const body   = req.body as Record<string, unknown>
      const errors = this.validatePayload(resource, body, 'update')
      if (errors) return res.status(422).json({ message: 'Validation failed.', errors })

      const record = await Model.query().update(id, body)
      return res.json({ data: record })
    }, mw)

    // ── DELETE /panel/api/resource/:id — delete ───────────
    router.delete(`${base}/:id`, async (req, res) => {
      const resource = new ResourceClass()
      const ctx      = this.buildContext(req)
      if (!await resource.policy('delete', ctx)) return res.status(403).json({ message: 'Forbidden.' })
      if (!Model) return res.status(500).json({ message: `Resource "${slug}" has no model defined.` })

      const id     = (req.params as Record<string, string>)['id']
      const exists = await Model.find(id)
      if (!exists) return res.status(404).json({ message: 'Record not found.' })

      await Model.query().delete(id)
      return res.json({ message: 'Deleted successfully.' })
    }, mw)

    // ── POST /panel/api/resource/_action/:action — bulk action
    router.post(`${base}/_action/:action`, async (req, res) => {
      const resource = new ResourceClass()
      const ctx      = this.buildContext(req)
      if (!await resource.policy('update', ctx)) return res.status(403).json({ message: 'Forbidden.' })

      const actionName = (req.params as Record<string, string>)['action']
      const action     = resource.actions().find((a: Action) => a.getName() === actionName)
      if (!action) return res.status(404).json({ message: `Action "${actionName}" not found.` })

      const { ids } = req.body as { ids?: string[] }
      if (!ids?.length) return res.status(422).json({ message: 'No records selected.' })

      // Fetch the records and execute the action
      const records: unknown[] = []
      if (Model) {
        for (const id of ids) {
          const record = await Model.find(id)
          if (record) records.push(record)
        }
      }

      await action.execute(records)
      return res.json({ message: 'Action executed successfully.' })
    }, mw)
  }

  // ── Helpers ────────────────────────────────────────────

  private buildContext(req: AppRequest): PanelContext {
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      user:    (req as any).user,
      headers: req.headers as Record<string, string>,
      path:    req.path,
    }
  }

  private validatePayload(
    resource: Resource,
    body: Record<string, unknown>,
    mode: 'create' | 'update',
  ): Record<string, string[]> | null {
    const fields = resource.fields()
    const errors: Record<string, string[]> = {}

    for (const field of fields) {
      if (field.isReadonly()) continue
      if (mode === 'create' && field.isHiddenFrom('create')) continue
      if (mode === 'update' && field.isHiddenFrom('edit')) continue

      const name  = field.getName()
      const value = body[name]

      if (field.isRequired() && (value === undefined || value === null || value === '')) {
        errors[name] = [`${field.getLabel()} is required.`]
      }
    }

    return Object.keys(errors).length > 0 ? errors : null
  }
}

// ─── Factory ───────────────────────────────────────────────

import type { Panel as PanelType } from './Panel.js'
import type { Application } from '@boostkit/core'

/**
 * Register one or more panels and mount their API routes.
 *
 * @example
 * import { panels } from '@boostkit/panels'
 * import { adminPanel, customerPanel } from './panels.js'
 *
 * export default [
 *   panels([adminPanel, customerPanel]),
 *   ...
 * ]
 */
export function panels(panelList: PanelType[]): new (app: Application) => PanelServiceProvider {
  return class extends PanelServiceProvider {
    register(): void {
      for (const panel of panelList) {
        PanelRegistry.register(panel)
      }
    }
  }
}
