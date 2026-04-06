import type { MiddlewareHandler } from '@rudderjs/core'
import type { RouterLike } from '../types.js'
import type { Panel } from '../../Panel.js'
import type { Resource, FieldOrGrouping } from '../../Resource.js'
import type { ModelClass, RecordRow } from '../../types.js'
import { flattenFields } from '../shared/fields.js'
import { handleList, handleRelated, handleSchema, handleOptions } from './listHandler.js'
import { handleShow } from './showHandler.js'
import { handleStore } from './storeHandler.js'
import { handleUpdate } from './updateHandler.js'
import { handleDelete, handleBulkDelete } from './deleteHandler.js'
import { handleAction } from './actionHandler.js'
import {
  handleRestore, handleForceDelete, handleBulkRestore, handleBulkForceDelete,
} from './softDeleteHandler.js'
import { mountVersionRoutes } from '../versionRoutes.js'
import { mountImportRoutes } from '../meta/importRoutes.js'
import { handleAgentRun } from '../agentRun.js'

export function mountResourceRoutes(
  router: RouterLike,
  panel: Panel,
  ResourceClass: typeof Resource,
  mw: MiddlewareHandler[],
): void {
  const slug = ResourceClass.getSlug()
  const base = `${panel.getApiBase()}/${slug}`
  const Model = ResourceClass.model as ModelClass<RecordRow> | undefined

  // Resolve resource config once at mount time
  const mountResource = new ResourceClass()
  const mountTableConfig = Model ? mountResource._resolveTable().getConfig() : undefined
  const mountFormMeta = mountResource._resolveForm().toMeta()
  const isLive = mountTableConfig?.live ?? false
  const isDraftable = !!mountFormMeta.draftable
  const isVersioned = !!mountFormMeta.versioned

  // ── List routes ──────────────────────────────────────────
  if (Model) {
    router.get(base, handleList(ResourceClass, slug, Model, isDraftable), mw)
    router.get(`${base}/_related`, handleRelated(ResourceClass, slug, Model), mw)
    router.get(`${base}/_options`, handleOptions(Model), mw)
  }
  router.get(`${base}/_schema`, handleSchema(ResourceClass), mw)

  // ── Show ─────────────────────────────────────────────────
  if (Model) {
    router.get(`${base}/:id`, handleShow(ResourceClass, slug, Model), mw)
  }

  // ── Create ───────────────────────────────────────────────
  if (Model) {
    router.post(base, handleStore(ResourceClass, slug, Model, isDraftable, isLive), mw)
  }

  // ── Update ───────────────────────────────────────────────
  if (Model) {
    router.put(`${base}/:id`, handleUpdate(ResourceClass, slug, Model, isLive), mw)
  }

  // ── Delete + bulk delete ─────────────────────────────────
  if (Model) {
    router.delete(`${base}/:id`, handleDelete(ResourceClass, slug, Model, isLive), mw)
    router.delete(base, handleBulkDelete(ResourceClass, slug, Model, isLive), mw)
  }

  // ── Bulk action ──────────────────────────────────────────
  router.post(`${base}/_action/:action`, handleAction(ResourceClass, slug, Model, isLive), mw)

  // ── Soft-delete routes ───────────────────────────────────
  const resolvedSoftDeletes = new ResourceClass()._resolveTable().getConfig().softDeletes
  if (resolvedSoftDeletes && Model) {
    router.post(`${base}/:id/_restore`, handleRestore(ResourceClass, slug, Model, isLive), mw)
    router.delete(`${base}/:id/_force`, handleForceDelete(ResourceClass, slug, Model, isLive), mw)
    router.post(`${base}/_restore`, handleBulkRestore(ResourceClass, slug, Model, isLive), mw)
    router.delete(`${base}/_force`, handleBulkForceDelete(ResourceClass, slug, Model, isLive), mw)
  }

  // ── Import routes ────────────────────────────────────────
  if (mountTableConfig?.importConfig) {
    mountImportRoutes(router, panel, ResourceClass, mw)
  }

  // ── Agent routes ─────────────────────────────────────────
  if (mountResource.agents().length > 0) {
    router.post(`${base}/:id/_agents/:agentSlug`, async (req, res) => {
      return handleAgentRun(req, res, ResourceClass, panel.getName())
    }, mw)
  }

  // ── Version routes ───────────────────────────────────────
  const versionResource = new ResourceClass()
  const hasCollabFields = flattenFields(versionResource._resolveForm().getFields() as FieldOrGrouping[]).some(f => f.isYjs())
  if (isVersioned || hasCollabFields) {
    mountVersionRoutes(router, panel, ResourceClass, mw)
  }
}
