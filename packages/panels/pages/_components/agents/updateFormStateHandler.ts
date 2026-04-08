/**
 * Browser-side handler for the AI `update_form_state` client tool.
 *
 * Routes write ops to one of two targets:
 *   1. **Plain field branch** — applies the op against `valuesRef` via the
 *      SchemaForm `setField` callback, which fires the same dependent-field
 *      recompute, persistence, and Y.Map sync as a human input event.
 *   2. **Lexical editor branch** — looks up the live editor in `lexicalRegistry`
 *      and runs every op inside one `editor.update()` (single undo step) using
 *      Lexical primitives loaded via dynamic import (no static dep on
 *      `@rudderjs/panels-lexical` from this package).
 *
 * The op vocabulary intentionally mirrors the server-side `edit_text` tool so
 * the agent uses one mental model regardless of routing.
 */

import { getLexicalEditor } from './lexicalRegistry.js'

// ── Op union ────────────────────────────────────────────────

export type TextFormatMarks = {
  bold?:          boolean
  italic?:        boolean
  underline?:     boolean
  strikethrough?: boolean
  code?:          boolean
}

export type ParagraphType = 'paragraph' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'quote' | 'code'

export type ParagraphSelector =
  | { paragraphIndex: number }
  | { textContains: string }

export type UpdateFormStateOp =
  // Any-field ops
  | { type: 'set_value'; value: unknown }
  // Text/string ops (work on plain text fields and Lexical text fields)
  | { type: 'rewrite_text'; text: string }
  | { type: 'replace'; search: string; replace: string }
  | { type: 'insert_after'; search: string; text: string }
  | { type: 'delete'; search: string }
  // Rich-text formatting ops (Lexical fields only)
  | { type: 'format_text'; search: string; marks: TextFormatMarks }
  | { type: 'set_link'; search: string; url: string }
  | { type: 'unset_link'; search: string }
  | { type: 'set_paragraph_type'; selector: ParagraphSelector; paragraphType: ParagraphType }
  | { type: 'insert_paragraph'; text: string; position?: number }
  // Block ops (Lexical fields only)
  | { type: 'insert_block'; blockType: string; blockData: Record<string, unknown>; position?: number }
  | { type: 'update_block'; blockType: string; blockIndex: number; field: string; value: unknown }
  | { type: 'delete_block'; blockType: string; blockIndex: number }

export interface UpdateFormStateArgs {
  field:      string
  operations: UpdateFormStateOp[]
}

export interface UpdateFormStateResult {
  applied:   number
  total:     number
  rejected?: string[]
  error?:    string
}

// ── Handler factory ────────────────────────────────────────

export interface UpdateFormStateDeps {
  /** Read-current-values ref kept up to date by SchemaForm. */
  valuesRef: { current: Record<string, unknown> }
  /** Stable callback to write a field value through SchemaForm.handleChange. */
  setField:  (name: string, value: unknown) => void
  /** Set of valid field names — used to reject unknown fields up front. */
  knownFields: () => Set<string>
  /**
   * Per-field allowlist of block type names. Block ops on a field absent from
   * this map (or missing the requested type) are rejected. The allowlist is
   * derived from `field._extra.blocks` in SchemaForm.
   */
  blockAllowlist: () => Map<string, Set<string>>
}

export function makeUpdateFormStateHandler(deps: UpdateFormStateDeps) {
  return async function handler(rawArgs: unknown): Promise<UpdateFormStateResult> {
    const args = rawArgs as UpdateFormStateArgs | undefined
    if (!args || typeof args !== 'object' || typeof args.field !== 'string') {
      return { applied: 0, total: 0, error: 'Invalid arguments: expected { field, operations }' }
    }

    const known = deps.knownFields()
    if (!known.has(args.field)) {
      return {
        applied: 0,
        total: args.operations?.length ?? 0,
        error: `Unknown field "${args.field}". Known fields: ${[...known].join(', ')}`,
      }
    }

    const ops = Array.isArray(args.operations) ? args.operations : []
    if (ops.length === 0) {
      return { applied: 0, total: 0, error: 'No operations supplied' }
    }

    // Phase 3 dev log — verifies the agent is routing through the client tool
    // path. Remove once Phase 5 ships.
    if (typeof console !== 'undefined') {
      // eslint-disable-next-line no-console
      console.log(
        `%c[update_form_state]%c field="${args.field}" ops=${ops.map(o => o.type).join(',')}`,
        'color:#8b5cf6;font-weight:bold',
        'color:inherit',
      )
    }

    const editor = getLexicalEditor(args.field)
    if (editor) {
      return applyLexicalOps(editor, args.field, ops, deps)
    }

    let applied = 0
    const rejected: string[] = []
    for (const op of ops) {
      const result = applyPlainOp(op, args.field, deps)
      if (result === true) applied++
      else if (typeof result === 'string') rejected.push(`${op.type}: ${result}`)
    }
    return {
      applied,
      total: ops.length,
      ...(rejected.length > 0 && { rejected }),
    }
  }
}

// ── Plain-field op application ─────────────────────────────

/** Returns true on success, a string on rejection (the rejection reason). */
function applyPlainOp(
  op: UpdateFormStateOp,
  field: string,
  deps: UpdateFormStateDeps,
): true | string {
  switch (op.type) {
    case 'set_value': {
      deps.setField(field, op.value)
      return true
    }
    case 'rewrite_text': {
      deps.setField(field, op.text)
      return true
    }
    case 'replace': {
      const current = String(deps.valuesRef.current[field] ?? '')
      if (!current.includes(op.search)) return `search text "${op.search}" not found in field "${field}"`
      deps.setField(field, current.split(op.search).join(op.replace))
      return true
    }
    case 'insert_after': {
      const current = String(deps.valuesRef.current[field] ?? '')
      const idx = current.indexOf(op.search)
      if (idx === -1) return `search text "${op.search}" not found in field "${field}"`
      const cut = idx + op.search.length
      deps.setField(field, current.slice(0, cut) + op.text + current.slice(cut))
      return true
    }
    case 'delete': {
      const current = String(deps.valuesRef.current[field] ?? '')
      if (!current.includes(op.search)) return `search text "${op.search}" not found in field "${field}"`
      deps.setField(field, current.split(op.search).join(''))
      return true
    }
    case 'insert_block':
    case 'update_block':
    case 'delete_block':
      return `block ops only work on Lexical-backed rich-content fields; "${field}" is plain`
    case 'format_text':
    case 'set_link':
    case 'unset_link':
    case 'set_paragraph_type':
    case 'insert_paragraph':
      return `formatting ops only work on Lexical-backed text/rich-content fields; "${field}" is plain`
    default: {
      const exhaustive: never = op
      return `unknown op "${(exhaustive as { type: string }).type}"`
    }
  }
}

// ── Lexical-field op application ───────────────────────────

// Minimal structural type for the LexicalEditor instance — avoids a static
// dep on `lexical` from this package. The real instance comes from the
// registry, which was populated by panels-lexical.
interface LexicalEditorLike {
  update(fn: () => void): void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerNodes?: any
}

async function applyLexicalOps(
  editor: LexicalEditorLike,
  field: string,
  ops: UpdateFormStateOp[],
  deps: UpdateFormStateDeps,
): Promise<UpdateFormStateResult> {
  // Dynamic imports — same pattern as `pages/@panel/+Layout.tsx`. These resolve
  // at runtime in the playground (or any host that installs panels-lexical).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let lexical: any, panelsLexical: any, richText: any, link: any, code: any
  try {
    ;[lexical, panelsLexical, richText, link, code] = await Promise.all([
      import('lexical'),
      import('@rudderjs/panels-lexical'),
      import('@lexical/rich-text'),
      import('@lexical/link'),
      import('@lexical/code'),
    ])
  } catch (err) {
    return {
      applied: 0,
      total: ops.length,
      error: `Failed to load Lexical modules: ${(err as Error).message}`,
    }
  }

  const { $getRoot, $createParagraphNode, $createTextNode } = lexical
  const { $createBlockNode, $isBlockNode } = panelsLexical
  const { $createHeadingNode, $createQuoteNode } = richText
  const { $createLinkNode, $isLinkNode } = link
  const { $createCodeNode } = code
  // applyTextOp is exported from CollaborativePlainText — re-exported via index? Check fallback.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const applyTextOp = (panelsLexical as unknown as { applyTextOp?: any }).applyTextOp as
    | ((op: { type: 'replace' | 'insert_after' | 'delete'; search: string; replace?: string; text?: string }, editor: unknown) => void)
    | undefined

  const allowlistMap = deps.blockAllowlist()
  const allowedForField = allowlistMap.get(field)

  let applied = 0
  const rejected: string[] = []

  // Single editor.update() = single undo step. Op rejections are collected
  // and returned alongside the success count.
  editor.update(() => {
    for (const op of ops) {
      try {
        switch (op.type) {
          case 'set_value': {
            // Coerce non-string values for a Lexical text field — only string
            // makes sense; everything else routes through valuesRef instead.
            const text = typeof op.value === 'string' ? op.value : String(op.value ?? '')
            replaceAllText($getRoot, $createParagraphNode, $createTextNode, text)
            applied++
            break
          }
          case 'rewrite_text': {
            replaceAllText($getRoot, $createParagraphNode, $createTextNode, op.text)
            applied++
            break
          }
          case 'replace':
          case 'insert_after':
          case 'delete': {
            if (!applyTextOp) {
              rejected.push(`${op.type}: applyTextOp helper unavailable in this build of @rudderjs/panels-lexical`)
              break
            }
            // Capture text content before to detect "no match" — applyTextOp is
            // silent on miss.
            const before = $getRoot().getTextContent()
            applyTextOp(op as never, editor)
            const after = $getRoot().getTextContent()
            if (before === after && op.type !== 'replace') {
              rejected.push(`${op.type}: search text "${op.search}" not found`)
            } else if (op.type === 'replace' && before === after && !before.includes(op.replace)) {
              rejected.push(`${op.type}: search text "${op.search}" not found`)
            } else {
              applied++
            }
            break
          }
          case 'format_text': {
            const target = findAndSplitText($getRoot, op.search)
            if (!target) {
              rejected.push(`format_text: search text "${op.search}" not found`)
              break
            }
            const formats: Array<keyof TextFormatMarks> = ['bold', 'italic', 'underline', 'strikethrough', 'code']
            for (const f of formats) {
              if (op.marks[f] === true && !target.hasFormat(f)) target.toggleFormat(f)
              else if (op.marks[f] === false && target.hasFormat(f)) target.toggleFormat(f)
            }
            applied++
            break
          }
          case 'set_link': {
            const target = findAndSplitText($getRoot, op.search)
            if (!target) {
              rejected.push(`set_link: search text "${op.search}" not found`)
              break
            }
            const linkNode = $createLinkNode(op.url)
            const newText = $createTextNode(target.getTextContent())
            // Preserve formatting from the original text node
            newText.setFormat(target.getFormat())
            linkNode.append(newText)
            target.replace(linkNode)
            applied++
            break
          }
          case 'unset_link': {
            // Walk all nodes to find a LinkNode whose text contains the search.
            let unwrapped = false
            const walk = (node: { getChildren?: () => unknown[] }): void => {
              if (unwrapped) return
              const children = node.getChildren?.() ?? []
              for (const child of children) {
                if (unwrapped) return
                if ($isLinkNode(child)) {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const link = child as any
                  if (link.getTextContent().includes(op.search)) {
                    // Unwrap: replace LinkNode with its children inline
                    const linkChildren = link.getChildren()
                    for (const lc of linkChildren) link.insertBefore(lc)
                    link.remove()
                    unwrapped = true
                    return
                  }
                }
                walk(child as { getChildren?: () => unknown[] })
              }
            }
            walk($getRoot())
            if (unwrapped) applied++
            else rejected.push(`unset_link: no link containing "${op.search}" found`)
            break
          }
          case 'set_paragraph_type': {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const root: any = $getRoot()
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let target: any = null
            if ('paragraphIndex' in op.selector) {
              target = root.getChildAtIndex(op.selector.paragraphIndex)
            } else {
              for (const child of root.getChildren()) {
                if (typeof child.getTextContent === 'function' && child.getTextContent().includes(op.selector.textContains)) {
                  target = child
                  break
                }
              }
            }
            if (!target) {
              rejected.push(`set_paragraph_type: paragraph not found for selector ${JSON.stringify(op.selector)}`)
              break
            }
            const newNode = createParagraphLikeNode(
              op.paragraphType,
              { $createParagraphNode, $createHeadingNode, $createQuoteNode, $createCodeNode },
            )
            if (!newNode) {
              rejected.push(`set_paragraph_type: unsupported type "${op.paragraphType}"`)
              break
            }
            // Move children from target → newNode, then replace
            const children = typeof target.getChildren === 'function' ? target.getChildren() : []
            for (const c of children) newNode.append(c)
            target.replace(newNode)
            applied++
            break
          }
          case 'insert_paragraph': {
            const p = $createParagraphNode()
            if (op.text) p.append($createTextNode(op.text))
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const root: any = $getRoot()
            if (typeof op.position === 'number') {
              const at = root.getChildAtIndex(op.position)
              if (at) at.insertBefore(p)
              else root.append(p)
            } else {
              root.append(p)
            }
            applied++
            break
          }
          case 'insert_block': {
            if (!allowedForField || !allowedForField.has(op.blockType)) {
              rejected.push(
                `insert_block: "${op.blockType}" not in allowlist for field "${field}". ` +
                `Allowed: ${allowedForField ? [...allowedForField].join(', ') || '(none)' : '(field has no blocks)'}`,
              )
              break
            }
            const node = $createBlockNode(op.blockType, op.blockData)
            const root = $getRoot()
            if (typeof op.position === 'number') {
              const target = root.getChildAtIndex(op.position)
              if (target) target.insertBefore(node)
              else root.append(node)
            } else {
              root.append(node)
            }
            applied++
            break
          }
          case 'update_block': {
            if (!allowedForField || !allowedForField.has(op.blockType)) {
              rejected.push(
                `update_block: "${op.blockType}" not in allowlist for field "${field}". ` +
                `Allowed: ${allowedForField ? [...allowedForField].join(', ') || '(none)' : '(field has no blocks)'}`,
              )
              break
            }
            const found = findBlockByTypeAndIndex($getRoot, $isBlockNode, op.blockType, op.blockIndex)
            if (!found) {
              rejected.push(`update_block: no "${op.blockType}" at index ${op.blockIndex}`)
              break
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const block = found as any
            block.setBlockData({ ...block.__blockData, [op.field]: op.value })
            applied++
            break
          }
          case 'delete_block': {
            if (!allowedForField || !allowedForField.has(op.blockType)) {
              rejected.push(
                `delete_block: "${op.blockType}" not in allowlist for field "${field}". ` +
                `Allowed: ${allowedForField ? [...allowedForField].join(', ') || '(none)' : '(field has no blocks)'}`,
              )
              break
            }
            const found = findBlockByTypeAndIndex($getRoot, $isBlockNode, op.blockType, op.blockIndex)
            if (!found) {
              rejected.push(`delete_block: no "${op.blockType}" at index ${op.blockIndex}`)
              break
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ;(found as any).remove()
            applied++
            break
          }
          default: {
            const exhaustive: never = op
            rejected.push(`unknown op "${(exhaustive as { type: string }).type}"`)
          }
        }
      } catch (err) {
        rejected.push(`${op.type}: ${(err as Error).message}`)
      }
    }
  })

  return {
    applied,
    total: ops.length,
    ...(rejected.length > 0 && { rejected }),
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function replaceAllText(getRoot: any, createParagraph: any, createText: any, text: string) {
  const root = getRoot()
  root.clear()
  // Split on newlines so multi-paragraph rewrites land as multiple paragraphs.
  const lines = text.split(/\r?\n/)
  for (const line of lines.length > 0 ? lines : ['']) {
    const p = createParagraph()
    if (line) p.append(createText(line))
    root.append(p)
  }
}

/**
 * Walk the editor's text nodes, find the first one whose content includes the
 * search string, splitText to isolate the matched range, and return the
 * resulting middle TextNode. Returns null if no match.
 *
 * Caller can then operate on the returned node directly (setFormat, replace
 * with LinkNode, etc.).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findAndSplitText(getRoot: any, search: string): any | null {
  const textNodes = getRoot().getAllTextNodes()
  for (const node of textNodes) {
    const text = node.getTextContent()
    const idx = text.indexOf(search)
    if (idx === -1) continue
    const parts = node.splitText(idx, idx + search.length)
    return idx === 0 ? parts[0]! : parts[1]!
  }
  return null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createParagraphLikeNode(type: ParagraphType, ctors: any): any | null {
  switch (type) {
    case 'paragraph': return ctors.$createParagraphNode()
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
      return ctors.$createHeadingNode(type)
    case 'quote': return ctors.$createQuoteNode()
    case 'code':  return ctors.$createCodeNode()
    default: return null
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findBlockByTypeAndIndex(getRoot: any, isBlockNode: (n: unknown) => boolean, blockType: string, blockIndex: number): unknown | null {
  let matchIndex = 0
  for (const child of getRoot().getChildren()) {
    if (isBlockNode(child) && (child as { __blockType: string }).__blockType === blockType) {
      if (matchIndex === blockIndex) return child
      matchIndex++
    }
  }
  return null
}
