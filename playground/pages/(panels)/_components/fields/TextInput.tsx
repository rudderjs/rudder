import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { getField, subscribeFields, useAiUi } from '@pilotiq/panels'
import type { ResolvedAiAction } from '@pilotiq/panels'
import { registerLexicalEditor } from '../agents/lexicalRegistry.js'
import type { FieldInputProps } from './types.js'
import { INPUT_CLS } from './types.js'

interface InlineAiAnchorRect {
  left:   number
  top:    number
  right:  number
  bottom: number
}

const typeMap: Record<string, string> = {
  text:     'text',
  email:    'email',
  number:   'number',
  date:     'date',
  datetime: 'datetime-local',
}

function formatDateValue(v: unknown, fieldType: string): string {
  if (!v) return ''
  const d = new Date(v as string)
  if (isNaN(d.getTime())) return String(v)
  if (fieldType === 'datetime') {
    return d.toISOString().slice(0, 16)
  }
  return d.toISOString().slice(0, 10)
}

/** Global registry of collaborative text editor refs for version restore. */
const collabTextRefs = new Map<string, { current: { setContent(text: string): void } | null }>()

/** Get the editor ref for a collaborative text field (used by version restore). */
export function getCollabTextRef(fieldName: string) {
  return collabTextRefs.get(fieldName)?.current ?? null
}

export function TextInput({ field, value, onChange, disabled = false, userName, userColor, wsPath, docName }: FieldInputProps) {
  const isDisabled = disabled || field.readonly
  const inputType = typeMap[field.type] ?? 'text'
  // AI surfaces come from the open-core slot bag (`AiUiContext`). When
  // `@pilotiq-pro/ai` is not installed, both slots are undefined and
  // inline AI is silently skipped — the CollabText editor still renders
  // normally, just without the ✦ selection trigger. The conditional hook
  // call is stable per mount because `<AiUiProvider>` is either present
  // from first render or absent for the lifetime of this instance (the
  // parent remounts on provider arrival — see `@panel/+Layout.tsx`).
  const { AiDropdown, useAiChat } = useAiUi()
  const aiChat = useAiChat ? useAiChat() : null
  const fieldName = field.name

  // Inline AI is only available on the COLLAB path (CollaborativePlainText
  // hosts a Lexical SelectionAiPlugin that emits the selection-action
  // callback). Non-collab plain `<input>` has no equivalent surface — for
  // those fields the field-level `✦` dropdown at the top of the field is
  // the only AI trigger. Gated on pro providing an AiDropdown slot.
  const aiActions: ResolvedAiAction[] = Array.isArray(field.ai) ? field.ai : []
  const hasInlineAi = aiActions.length > 0 && !!AiDropdown

  const [menu, setMenu] = useState<{ text: string; rect: InlineAiAnchorRect } | null>(null)

  const onSelectionAction = useCallback((text: string, rect: InlineAiAnchorRect) => {
    setMenu({ text, rect })
  }, [])

  const onAskChat = useCallback((text: string) => {
    if (aiChat) {
      aiChat.setSelection({ field: fieldName, text })
      aiChat.setOpen(true)
    }
  }, [aiChat, fieldName])

  const inputValue = (field.type === 'date' || field.type === 'datetime')
    ? formatDateValue(value, field.type)
    : (value as string) ?? ''

  // Editor ref for imperative control (version restore)
  const editorRef = useRef<{ setContent(text: string): void } | null>(null)
  const nativeInputRef = useRef<HTMLInputElement>(null)
  const isCollabPath = !!(field.yjs && wsPath && docName && (field.type === 'text' || field.type === 'email'))

  useEffect(() => {
    if (field.yjs) {
      collabTextRefs.set(field.name, editorRef)
      return () => { collabTextRefs.delete(field.name) }
    }
  }, [field.name, field.yjs])

  // Register the live LexicalEditor instance under this field name so the AI
  // `update_form_state` client tool can dispatch ops via editor.update().
  const onEditorMount = useCallback(
    (editor: Parameters<typeof registerLexicalEditor>[1]) =>
      registerLexicalEditor(fieldName, editor),
    [fieldName],
  )

  // Collaborative text — reactively wait for the Lexical component to register.
  const CollabText = useSyncExternalStore(
    subscribeFields,
    () => getField('_lexical:collaborativePlainText') ?? null,
    () => null, // SSR snapshot — never render collab on server
  )

  // Slot-bag `AiDropdown` reads its own api context (apiBase, resourceSlug,
  // recordId) from a pro-side provider mounted inside `<AiUiProvider>`, so
  // free field inputs no longer need to pass those props. Undefined slot →
  // null element → nothing renders.
  const dropdownEl = menu && AiDropdown && (
    <AiDropdown
      fieldName={fieldName}
      actions={aiActions}
      selection={{ text: menu.text }}
      position={{ mode: 'fixed', left: menu.rect.left, top: menu.rect.bottom + 4 }}
      onClose={() => setMenu(null)}
    />
  )

  if (CollabText && isCollabPath) {
    return (
      <>
        <CollabText
          value={(value as string) ?? ''}
          onChange={(v: unknown) => onChange(v)}
          wsPath={wsPath}
          docName={docName}
          fieldName={field.name}
          className={INPUT_CLS}
          placeholder={(field.extra?.placeholder as string) ?? ''}
          disabled={isDisabled}
          required={field.required}
          {...(userName !== undefined ? { userName } : {})}
          {...(userColor !== undefined ? { userColor } : {})}
          editorRef={editorRef}
          onEditorMount={onEditorMount}
          {...(hasInlineAi ? { onSelectionAction } : {})}
          {...(aiChat      ? { onAskChat }         : {})}
        />
        {dropdownEl}
      </>
    )
  }

  // Non-collab plain input — no inline AI surface. The field-level `✦`
  // dropdown at the top of the field (rendered by SchemaRenderer) is the
  // only AI trigger.
  return (
    <input
      ref={nativeInputRef}
      type={inputType}
      name={field.name}
      value={inputValue}
      onChange={(e) => onChange(field.type === 'number' ? e.target.valueAsNumber : e.target.value)}
      required={field.required}
      readOnly={field.readonly}
      disabled={isDisabled}
      placeholder={(field.extra?.placeholder as string) ?? ''}
      className={INPUT_CLS}
    />
  )
}
