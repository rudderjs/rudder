import { PanelRegistry, resolveForm } from '@boostkit/panels'
import type { FieldOrGrouping, Field, QueryBuilderLike, RecordRow, PanelSchemaElementMeta, PanelUser } from '@boostkit/panels'
import { getSessionUser } from '../../../../../_lib/getSessionUser.js'
import type { PageContextServer } from 'vike/types'

export type Data = Awaited<ReturnType<typeof data>>

function flattenFields(items: (Field | { getFields(): Field[] })[]): Field[] {
  const result: Field[] = []
  for (const item of items) {
    if ('getFields' in item) result.push(...flattenFields(item.getFields()))
    else result.push(item as Field)
  }
  return result
}

export async function data(pageContext: PageContextServer) {
  const { panel: pathSegment, resource: slug, id } = pageContext.routeParams as { panel: string; resource: string; id: string }

  const panel = PanelRegistry.all().find((p) => p.getPath() === `/${pathSegment}`)
  if (!panel) throw new Error(`Panel "/${pathSegment}" not found.`)

  const ResourceClass = panel.getResources().find((R) => R.getSlug() === slug)
  if (!ResourceClass) throw new Error(`Resource "${slug}" not found.`)

  const resource     = new ResourceClass()
  const resourceMeta = resource.toMeta()
  const panelMeta    = panel.toMeta()
  const sessionUser  = await getSessionUser(pageContext)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Model  = ResourceClass.model as any
  const formFields = flattenFields(resource._resolveForm().getFields() as FieldOrGrouping[])

  let record: RecordRow | null = null
  if (Model) {
    let q: QueryBuilderLike<RecordRow> = Model.query()
    for (const f of formFields) {
      const type = f.getType()
      const name = f.getName()
      if (type === 'belongsTo') {
        const rel = ((f as unknown as { _extra: Record<string, unknown> })._extra?.['relationName'] as string) ?? (name.endsWith('Id') ? name.slice(0, -2) : name)
        q = q.with(rel)
      } else if (type === 'belongsToMany') {
        q = q.with(name)
      }
    }
    record = await q.find(id)
  }

  // ── Build PanelContext with session support ──
  let sessionGet: ((key: string) => unknown) | undefined
  try {
    const { app: getApp } = await import('@boostkit/core') as { app(): { make<T>(key: string): T } }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sessionConfig = getApp().make<any>('session.config')
    if (sessionConfig?.secret && sessionConfig?.cookie?.name) {
      const cookieHeader = ((pageContext as any).headers?.cookie ?? '') as string
      const cookieName = sessionConfig.cookie.name as string
      const match = cookieHeader.split(';').map((c: string) => c.trim()).find((c: string) => c.startsWith(`${cookieName}=`))
      if (match) {
        const cookieValue = decodeURIComponent(match.slice(cookieName.length + 1))
        const { createHmac } = await import('node:crypto')
        const dotIdx = cookieValue.lastIndexOf('.')
        if (dotIdx !== -1) {
          const b64 = cookieValue.slice(0, dotIdx)
          const hmac = cookieValue.slice(dotIdx + 1)
          const expected = createHmac('sha256', sessionConfig.secret as string).update(b64).digest('base64url')
          if (expected === hmac) {
            const payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8')) as { data: Record<string, unknown> }
            sessionGet = (key: string) => payload.data[key]
          }
        }
      }
    }
  } catch { /* session not available */ }

  const ctx = {
    user: sessionUser as PanelUser | undefined,
    headers: (pageContext as PageContextServer & { headers?: Record<string, string> }).headers ?? {},
    path: pageContext.urlPathname,
    params: {},
    urlSearch: pageContext.urlParsed?.search ?? {},
    sessionGet,
  }

  // ── Resolve the resource form through resolveForm() ──
  const form = resource._resolveForm()
  form.action(`/${pathSegment}/api/${slug}/${id}`)
  form.method('PUT')
  // Set record as initial values
  if (record) {
    form.data(async () => record as Record<string, unknown>)
  }

  const formElement = await resolveForm(form as any, panel, ctx)

  // Feature flags
  const versioned = ResourceClass.versioned
  const draftable = ResourceClass.draftable

  // Extract Yjs config from resolved form element (edit page hooks need them directly)
  const formMeta = formElement as PanelSchemaElementMeta & { yjs?: boolean; wsLivePath?: string | null; docName?: string | null; liveProviders?: string[] }

  return {
    panelMeta, resourceMeta, record, formElement, pathSegment, slug, id, sessionUser,
    versioned, draftable,
    yjs: formMeta.yjs ?? false,
    wsLivePath: formMeta.wsLivePath ?? null,
    docName: formMeta.docName ?? null,
    liveProviders: formMeta.liveProviders ?? [],
  }
}
