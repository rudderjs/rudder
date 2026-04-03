import type { MiddlewareHandler, AppRequest, AppResponse } from '@rudderjs/core'
import { Orchestrator } from '../orchestrator/Orchestrator.js'
import type { CanvasNode } from '../canvas/CanvasNode.js'

type RouteHandler = (req: AppRequest, res: AppResponse) => unknown
interface RouterShape {
  post(path: string, handler: RouteHandler, mw?: MiddlewareHandler[]): void
  get(path: string, handler: RouteHandler, mw?: MiddlewareHandler[]): void
}

/**
 * Mount chat API routes on the panel router.
 *
 * POST /api/panel/workspaces/:id/chat — send a message (SSE streaming response)
 */
export function mountChatRoutes(
  router: RouterShape,
  apiBase: string,
  mw: MiddlewareHandler[],
  getPrisma: () => Promise<any>,
): void {
  // POST /workspaces/:id/chat — streaming chat
  router.post(`${apiBase}/workspaces/:id/chat`, async (req: AppRequest, res: AppResponse) => {
    const workspaceId = (req as any).params?.id ?? (req as any).param?.('id')
    const body = typeof (req as any).json === 'function' ? await (req as any).json() : (req as any).body
    const { message, conversationId } = body as { message: string; conversationId?: string }

    if (!message) {
      return new Response(JSON.stringify({ error: 'message is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Load workspace from DB
    let workspace: any
    try {
      const prisma = await getPrisma()
      workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } })
    } catch {
      return new Response(JSON.stringify({ error: 'Database error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (!workspace) {
      return new Response(JSON.stringify({ error: 'Workspace not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Parse nodes from JSON column
    let nodesMap: Map<string, CanvasNode>
    try {
      const nodesJson = typeof workspace.nodes === 'string' ? JSON.parse(workspace.nodes) : workspace.nodes
      nodesMap = new Map(Object.entries(nodesJson))
    } catch {
      nodesMap = new Map()
    }

    // Create orchestrator
    const orchestrator = new Orchestrator({
      name: workspace.name,
      nodes: nodesMap,
    })

    // Stream response as SSE
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const result = orchestrator.stream(message, conversationId)

          // Send conversation ID first
          const convId = await result.response.then(r => r.conversationId).catch(() => null)
          if (convId) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'conversation-id', conversationId: convId })}\n\n`))
          }

          for await (const chunk of result.stream) {
            const data = JSON.stringify(chunk)
            controller.enqueue(encoder.encode(`data: ${data}\n\n`))
          }

          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: msg })}\n\n`))
        } finally {
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  }, mw)
}
