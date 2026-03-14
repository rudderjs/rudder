import { useState, useCallback, useContext, createContext } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getNodeByKey } from 'lexical'
import type { FieldMeta, BlockMeta } from '@boostkit/panels'
import { $isBlockNode } from './BlockNode.js'

export const BlockRegistryContext = createContext<Map<string, BlockMeta>>(new Map())

interface Props {
  nodeKey: string
  blockType: string
  blockData: Record<string, unknown>
}

export function BlockNodeComponent({ nodeKey, blockType, blockData }: Props) {
  const [editor] = useLexicalComposerContext()
  const registry = useContext(BlockRegistryContext)
  const blockMeta = registry.get(blockType)
  const [editing, setEditing] = useState(false)

  const updateField = useCallback((fieldName: string, value: unknown) => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey)
      if ($isBlockNode(node)) {
        node.setBlockData({ ...node.__blockData, [fieldName]: value })
      }
    })
  }, [editor, nodeKey])

  if (!blockMeta) {
    return (
      <div className="border border-destructive rounded-lg p-3 text-sm text-destructive my-2">
        Unknown block type: {blockType}
      </div>
    )
  }

  if (editing) {
    return (
      <div className="rounded-lg border-2 border-primary/50 p-4 bg-muted/30 space-y-3 my-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {blockMeta.icon && <span className="mr-1">{blockMeta.icon}</span>}
            {blockMeta.label}
          </span>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="text-xs text-primary hover:underline"
          >
            Done
          </button>
        </div>

        {(blockMeta.schema ?? []).map((field: FieldMeta) => (
          <div key={field.name}>
            <label className="text-sm font-medium mb-1 block">{field.label}</label>
            <SimpleFieldInput
              field={field}
              value={blockData[field.name]}
              onChange={(v) => updateField(field.name, v)}
            />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div
      onClick={() => setEditing(true)}
      className="rounded-lg border border-border p-3 cursor-pointer transition-colors hover:border-primary/30 hover:bg-accent/10 my-2"
    >
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {blockMeta.icon && <span className="mr-1">{blockMeta.icon}</span>}
        {blockMeta.label}
      </span>
      <div className="text-sm mt-1 text-foreground/80">
        {(blockMeta.schema ?? [])
          .filter((f: FieldMeta) => blockData[f.name])
          .map((f: FieldMeta) => (
            <span key={f.name} className="mr-3">
              <span className="text-muted-foreground">{f.label}:</span>{' '}
              {String(blockData[f.name]).slice(0, 50)}
            </span>
          ))
        }
        {(blockMeta.schema ?? []).every((f: FieldMeta) => !blockData[f.name]) && (
          <span className="text-muted-foreground italic">Click to edit…</span>
        )}
      </div>
    </div>
  )
}

function SimpleFieldInput({ field, value, onChange }: {
  field: FieldMeta; value: unknown; onChange: (v: unknown) => void
}) {
  if (field.type === 'boolean' || field.type === 'toggle') {
    return (
      <input
        type="checkbox"
        checked={!!value}
        onChange={(e) => onChange(e.target.checked)}
        className="rounded border-input"
      />
    )
  }
  if (field.type === 'select' && field.extra?.options) {
    return (
      <select
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
      >
        <option value="">Select…</option>
        {(field.extra.options as { value: string; label: string }[]).map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    )
  }
  if (field.type === 'textarea') {
    return (
      <textarea
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
      />
    )
  }
  return (
    <input
      type="text"
      value={String(value ?? '')}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
    />
  )
}
