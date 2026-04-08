/**
 * Inline progress popover for an AI action run. Reusable across panels-side
 * AI surfaces (per-field `✦` quick actions, resource-level `AI Agents`
 * dropdown, and any future field/selection-rooted action).
 *
 * **Renders:**
 * - **Running**: pulsing dot + "Working…" header, streamed text deltas + tool-call
 *   indicators ("✓ Read record" / "✓ Updated metaTitle" / etc.)
 * - **Complete**: green check + "Done" header. Caller is responsible for
 *   auto-dismissing via `useEffect` watching `status === 'complete'`.
 * - **Error**: red border, alert icon + "Error" header, persistent until dismissed.
 *
 * Per `feedback_inline_over_modal.md`: rendered inline next to the action's
 * trigger button, not as a modal. The caller controls positioning via the
 * `className` prop, which is appended to the popover's outer div — pass
 * absolute-positioning classes to anchor it (e.g.
 * `'absolute left-0 top-full mt-1'` to anchor below-left, or
 * `'absolute right-0 bottom-full mb-1'` to anchor above-right).
 *
 * **Data source:** the `entries` and `status` come straight from
 * `useAgentRun()` — see `useAgentRun.ts`. Pass `reset` from the same hook
 * as `onDismiss` so dismissing the popover also clears the hook state.
 */

import type { ReactNode } from 'react'

export interface AiActionProgressEntry {
  type:    'text' | 'tool_call' | 'complete' | 'error'
  text?:   string
  tool?:   string
  input?:  Record<string, unknown>
  message?: string
}

export interface AiActionProgressProps {
  entries:   AiActionProgressEntry[]
  status:    'idle' | 'running' | 'complete' | 'error'
  onDismiss: () => void
  /**
   * Tailwind classes for positioning the popover. Caller decides where it
   * anchors relative to its trigger button. Defaults to "below-left" which
   * matches the per-field `✦` button in `SchemaRenderer.AiQuickActions`.
   */
  className?: string
}

const DEFAULT_POSITION = 'absolute left-0 top-full mt-1'

export function AiActionProgress({
  entries,
  status,
  onDismiss,
  className = DEFAULT_POSITION,
}: AiActionProgressProps): ReactNode {
  const isRunning  = status === 'running'
  const isError    = status === 'error'
  const isComplete = status === 'complete'

  return (
    <div
      className={`${className} w-72 rounded-md border shadow-md z-30 text-xs ${
        isError ? 'border-destructive/40 bg-destructive/5' : 'bg-popover'
      }`}
    >
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/50">
        <div className="flex items-center gap-1.5 text-foreground/80 font-medium">
          {isRunning && (
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          )}
          {isComplete && (
            <svg className="w-3 h-3 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
          {isError && (
            <svg className="w-3 h-3 text-destructive" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          )}
          <span>
            {isRunning && 'Working…'}
            {isComplete && 'Done'}
            {isError && 'Error'}
          </span>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-muted-foreground hover:text-foreground text-base leading-none"
          title="Dismiss"
        >
          ×
        </button>
      </div>
      <div className="px-3 py-2 space-y-1.5 max-h-48 overflow-y-auto">
        {entries.map((entry, i) => {
          if (entry.type === 'text' && entry.text) {
            return (
              <div key={i} className="text-foreground/70 whitespace-pre-wrap leading-relaxed">
                {entry.text}
              </div>
            )
          }
          if (entry.type === 'tool_call' && entry.tool) {
            return (
              <div key={i} className="flex items-center gap-1.5 text-muted-foreground">
                <svg className="w-3 h-3 text-primary/70 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <span>{describeToolCall(entry.tool, entry.input)}</span>
              </div>
            )
          }
          if (entry.type === 'error') {
            return (
              <div key={i} className="text-destructive">
                {entry.message}
              </div>
            )
          }
          return null
        })}
      </div>
    </div>
  )
}

/** Map a tool name + args to a short human-readable description for the popover. */
function describeToolCall(tool: string, input?: Record<string, unknown>): string {
  const fieldArg = typeof input?.['field'] === 'string' ? (input['field'] as string) : undefined
  switch (tool) {
    case 'read_record':       return 'Read record'
    case 'read_form_state':   return 'Read form state'
    case 'update_field':      return fieldArg ? `Updated ${fieldArg}` : 'Updated field'
    case 'update_form_state': return fieldArg ? `Updated ${fieldArg}` : 'Updated field'
    case 'edit_text':         return fieldArg ? `Edited ${fieldArg}`  : 'Edited text'
    default:                  return `Called ${tool}`
  }
}
