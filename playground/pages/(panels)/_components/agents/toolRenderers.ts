/**
 * Browser-side registry of tool result renderers.
 *
 * Each entry pairs a tool name with a React component that knows how to
 * render that tool's args, preliminary progress (`tool-update` chunks from
 * async-generator executes), and final result inline in the chat bubble.
 *
 * This is the "generative UI" surface for `@pilotiq/panels` chat — the
 * counterpart to {@link ./clientTools.ts}, which holds *executors* for
 * client-side tools. Renderers are pure presentational React, owned by
 * application code; this file only provides the registry mechanism.
 *
 * Components register renderers in a `useEffect` (or, for built-in
 * always-available renderers, at module load) — typically:
 *
 * ```ts
 * useEffect(() => registerToolRenderer('run_agent', AgentRunRenderer), [])
 * ```
 *
 * The chat bubble (`AiChatPanel.tsx`) looks up the renderer for each
 * `tool_call` part by name. If no renderer is registered, the existing
 * default rendering applies — making the registry a purely additive
 * extension point.
 *
 * **Why a registry, not a switch?** RudderJS uses registries as its default
 * extension mechanism (~30 of them across the monorepo). A downstream
 * package can ship its own tool *and* its own renderer and register both
 * from a service provider's `boot()` without forking `@pilotiq/panels`.
 * Vercel uses an inline JSX switch in their chat component, which closes
 * the extension surface. See `docs/plans/ai-loop-parity-plan.md` Phase 3
 * for the full rationale.
 */

import type { ReactNode } from 'react'

/**
 * Status of the tool call as the chat reads it from the SSE stream.
 *
 * - `running`  — `tool_call` event arrived; tool has not yet returned
 * - `complete` — `tool_result` event arrived for this id
 * - `error`    — the `tool_result` carried an Error string (best-effort)
 */
export type ToolRendererStatus = 'running' | 'complete' | 'error'

/**
 * Props passed to a tool renderer component on every render.
 *
 * `updates` is the in-order list of preliminary `tool-update` payloads
 * accumulated since the call started. It is capped at 200 entries by the
 * chat context (see R5 in the plan); renderers that need more should
 * down-sample at registration time, not assume unbounded history.
 */
export interface ToolRendererProps {
  toolCallId: string
  args:       unknown
  updates:    unknown[]
  result?:    unknown
  status:     ToolRendererStatus
}

export type ToolRenderer = (props: ToolRendererProps) => ReactNode

const renderers = new Map<string, ToolRenderer>()

/**
 * Register a renderer for a tool. Returns an unregister function so it can
 * be cleaned up from `useEffect`.
 *
 * Last-write-wins if two callers register the same name; the unregister
 * function is identity-checked, so a stale unmount won't clobber a fresh
 * renderer registered for the same tool.
 */
export function registerToolRenderer(name: string, renderer: ToolRenderer): () => void {
  renderers.set(name, renderer)
  return () => {
    if (renderers.get(name) === renderer) renderers.delete(name)
  }
}

/** Returns the renderer registered for `name`, or `undefined`. */
export function getToolRenderer(name: string): ToolRenderer | undefined {
  return renderers.get(name)
}

/** Returns true if a renderer is registered for `name`. */
export function hasToolRenderer(name: string): boolean {
  return renderers.has(name)
}
