'use client'

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import type { ResolvedAiAction } from '@rudderjs/panels'
import { useAgentRun } from './useAgentRun.js'
import { useAiChatSafe } from './AiChatContext.js'
import { AiActionProgress } from './AiActionProgress.js'

// TODO(i18n): the labels in this component ("Selection:", "Discuss in chat",
// "Tell AI what to do…", action labels) are hardcoded English. Wire through
// @rudderjs/localization in a follow-up per feedback_panels_localization.md.

const TRANSLATE_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'ar', label: 'Arabic' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'zh', label: 'Chinese' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'ru', label: 'Russian' },
  { code: 'tr', label: 'Turkish' },
  { code: 'hi', label: 'Hindi' },
]

export type AiDropdownPosition =
  | { mode: 'absolute' }
  | { mode: 'fixed'; left: number; top: number }

export interface AiDropdownProps {
  fieldName:    string
  /** Pre-resolved action list from `field.ai`. Same shape used by both triggers. */
  actions:      ResolvedAiAction[]
  apiBase:      string
  resourceSlug: string
  recordId:     string
  /**
   * Captured selection text, frozen at trigger-click time. Null when the
   * dropdown was opened without a selection (whole-field mode).
   */
  selection:    { text: string } | null
  /** Anchor mode — `absolute` for the field-level trigger, `fixed` for the inline trigger. */
  position:     AiDropdownPosition
  onClose:      () => void
}

/**
 * Shared dropdown body for both AI trigger surfaces:
 *
 * 1. **Field-level `✦`** in `SchemaRenderer.AiQuickActions` — anchored
 *    `absolute` below the trigger button at the top of every field with
 *    `.ai([...])` opted in.
 * 2. **Inline `✦`** in `panels-lexical` `FloatingToolbarPlugin` (richcontent)
 *    and `SelectionAiPlugin` (collab plain text) — anchored `fixed` next to
 *    the selection rect, only visible when text is selected in a Lexical
 *    editor.
 *
 * Both triggers render the **same dropdown content** to keep the UX
 * consistent: a selection-aware header, the field's quick actions, a
 * `💬 Discuss in chat` item (when a selection + chat are both available),
 * and a free-form textarea that submits to the global `freeform` built-in.
 *
 * **State ownership:** the dropdown owns its own `useAgentRun` instance,
 * prompt state, and auto-dismiss timer. The parent only owns "is the
 * dropdown open" — when it sets open to false (or unmounts the dropdown),
 * any in-flight run is aborted via the `useAgentRun` cleanup. Outside-click
 * and Escape dismiss are handled inside the dropdown and ignored while a
 * run is in progress so the user doesn't accidentally kill it mid-action.
 */
export function AiDropdown({
  fieldName,
  actions,
  apiBase,
  resourceSlug,
  recordId,
  selection,
  position,
  onClose,
}: AiDropdownProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [translateOpen, setTranslateOpen] = useState(false)
  const [prompt, setPrompt] = useState('')

  const { run, reset, entries, status } = useAgentRun(apiBase, resourceSlug)
  const aiChat = useAiChatSafe()

  const isRunning   = status === 'running'
  const showProgress = entries.length > 0
  const showChatItem = !!(selection && aiChat)

  // Auto-dismiss after a clean completion. Errors stay until dismissed.
  useEffect(() => {
    if (status !== 'complete') return
    const timer = setTimeout(() => { reset(); onClose() }, 1500)
    return () => clearTimeout(timer)
  }, [status, reset, onClose])

  // Outside-click + Escape dismiss. Both ignored while a run is in progress
  // so the user doesn't accidentally kill the action mid-flight.
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (isRunning) return
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    function onKey(e: KeyboardEvent | any) {
      if (isRunning) return
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [isRunning, onClose])

  // Selection mode (Phase 1 server) is activated by passing the captured
  // selection in run opts. Without selection the run targets the whole field.
  function buildRunOpts() {
    return selection
      ? { field: fieldName, selection: { field: fieldName, text: selection.text } }
      : { field: fieldName }
  }

  function handleAction(action: ResolvedAiAction, languageHint?: string) {
    const scope = selection ? 'selected text' : `${fieldName} field`
    const input = languageHint
      ? `Translate the ${scope} to ${languageHint}.`
      : `Run the "${action.label}" action on the ${scope}.`
    run(action.slug, recordId, input, buildRunOpts())
    setTranslateOpen(false)
  }

  function handleFreeform() {
    const text = prompt.trim()
    if (!text) return
    // The `freeform` built-in is registered globally by PanelServiceProvider
    // and is always available regardless of which slugs the field opted into
    // via `Field.ai([...])`. The user's typed prompt is the run input; the
    // selection block from Phase 1 layers on top when selection is set.
    run('freeform', recordId, text, buildRunOpts())
    setPrompt('')
  }

  function handleDiscussInChat() {
    if (!selection || !aiChat) return
    aiChat.setSelection({ field: fieldName, text: selection.text })
    aiChat.setOpen(true)
    onClose()
  }

  function handleTextareaKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter submits, Shift+Enter inserts newline (chat-style).
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleFreeform()
    }
  }

  // Truncate selection preview to keep the header compact.
  const previewText = selection
    ? (selection.text.length > 50 ? `${selection.text.slice(0, 50)}…` : selection.text)
    : ''

  // Wrapper class differs by anchor mode. Body content is identical.
  const wrapperClass = position.mode === 'fixed'
    ? 'fixed z-50 w-64'
    : 'absolute left-0 top-full mt-1 w-64'
  const wrapperStyle = position.mode === 'fixed'
    ? { left: `${position.left}px`, top: `${position.top}px` }
    : undefined

  const body = (
    <div
      ref={ref}
      className={`${wrapperClass} rounded-md border bg-popover shadow-md z-30`}
      style={wrapperStyle}
    >
      {showProgress ? (
        <div className="p-2">
          <AiActionProgress
            entries={entries}
            status={status}
            onDismiss={() => { reset(); onClose() }}
            className="static"
          />
        </div>
      ) : (
        <>
          {selection && (
            <div
              className="px-3 py-1.5 border-b text-[10px] text-muted-foreground"
              title={selection.text}
            >
              Selection: <span className="text-foreground font-mono">"{previewText}"</span>
            </div>
          )}
          <div className="py-1">
            {actions.map(a => (
              a.slug === 'translate' ? (
                <div key={a.slug} className="relative">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between px-3 py-1.5 text-xs hover:bg-muted/50 text-left"
                    onClick={() => setTranslateOpen(!translateOpen)}
                  >
                    {a.label}
                    <span className="text-[10px] text-muted-foreground ml-2">{'>'}</span>
                  </button>
                  {translateOpen && (
                    <div className="absolute left-full top-0 ml-1 min-w-[120px] rounded-md border bg-popover shadow-md z-30 py-1 max-h-64 overflow-y-auto">
                      {TRANSLATE_LANGUAGES.map(lang => (
                        <button
                          key={lang.code}
                          type="button"
                          className="flex w-full items-center px-3 py-1.5 text-xs hover:bg-muted/50 text-left"
                          onClick={() => handleAction(a, lang.label)}
                        >
                          {lang.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <button
                  key={a.slug}
                  type="button"
                  className="flex w-full items-center px-3 py-1.5 text-xs hover:bg-muted/50 text-left"
                  onClick={() => handleAction(a)}
                >
                  {a.label}
                </button>
              )
            ))}
          </div>
          {showChatItem && (
            <div className="border-t py-1">
              <button
                type="button"
                className="flex w-full items-center px-3 py-1.5 text-xs hover:bg-muted/50 text-left"
                onClick={handleDiscussInChat}
              >
                💬 Discuss in chat
              </button>
            </div>
          )}
          <div className="border-t p-2 flex items-end gap-1.5">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleTextareaKeyDown}
              placeholder="Tell AI what to do…"
              rows={2}
              className="flex-1 rounded border border-input bg-background px-2 py-1 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              type="button"
              disabled={!prompt.trim()}
              onClick={handleFreeform}
              className="h-6 w-6 flex items-center justify-center rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Send (Enter)"
            >
              <span className="text-xs leading-none">↑</span>
            </button>
          </div>
        </>
      )}
    </div>
  )

  // Fixed-mode renders to a portal so the dropdown isn't clipped by overflow
  // ancestors (Lexical editors / form sections often have overflow: hidden).
  // Absolute-mode stays in the parent's flow so positioning is relative to
  // the trigger button.
  if (position.mode === 'fixed') {
    if (typeof document === 'undefined') return null
    return createPortal(body, document.body)
  }
  return body
}
