import { useState } from 'react'
import type { FieldMeta, NodeMap } from '@rudderjs/panels'
import { ensureNodeMap, addNode, updateNodeProps, removeNode, reorderNode } from '@rudderjs/panels'
import { SortableBlockList } from '../SortableBlockList.js'
import type { FieldInputProps } from './types.js'
import { FieldInput } from '../FieldInput.js'

export function BuilderInput({ field, value, onChange, uploadBase = '', disabled = false, i18n }: FieldInputProps) {
  const isDisabled = disabled || field.readonly
  const blockDefs = (field.extra?.blocks ?? []) as Array<{
    name: string; label: string; icon?: string; schema: FieldMeta[]
  }>
  const addLabel  = (field.extra?.addLabel as string) ?? i18n.addBlock
  const maxItems  = field.extra?.maxItems as number | undefined
  const nodeMap   = ensureNodeMap(value)
  const root      = nodeMap.ROOT ?? { type: 'container', props: {}, parent: '', nodes: [] }
  const nodeIds   = root.nodes
  const [pickerOpen, setPickerOpen] = useState(false)

  function emit(next: NodeMap) { onChange(next) }

  function handleAddBlock(blockName: string) {
    const def = blockDefs.find((b) => b.name === blockName)
    if (!def) return
    const props: Record<string, unknown> = {}
    for (const f of def.schema) props[f.name] = undefined
    const { map } = addNode(nodeMap, blockName, props)
    emit(map)
    setPickerOpen(false)
  }

  function handleReorder(fromIndex: number, toIndex: number) {
    const id = nodeIds[fromIndex]
    if (!id) return
    emit(reorderNode(nodeMap, id, fromIndex, toIndex))
  }

  const atMax = maxItems !== undefined && nodeIds.length >= maxItems

  return (
    <div className="flex flex-col gap-3">
      <SortableBlockList
        nodeIds={nodeIds}
        onReorder={handleReorder}
        disabled={isDisabled}
        renderNode={(id) => {
          const node = nodeMap[id]
          if (!node) return null
          const def = blockDefs.find((b) => b.name === node.type)
          return (
            <div className="rounded-lg border border-input bg-card overflow-hidden">
              {/* Block header */}
              <div className="flex items-center justify-between px-4 py-2 bg-muted/50 border-b border-input">
                <span className="flex items-center gap-2 text-xs font-medium">
                  {def?.icon && <span>{def.icon}</span>}
                  <span className="text-muted-foreground uppercase tracking-wide">
                    {def?.label ?? node.type}
                  </span>
                </span>
                {!isDisabled && (
                  <button
                    type="button"
                    onClick={() => emit(removeNode(nodeMap, id))}
                    className="px-1.5 py-0.5 text-xs text-destructive hover:underline"
                  >{i18n.remove}</button>
                )}
              </div>

              {/* Block fields */}
              <div className="p-4 flex flex-col gap-4">
                {(def?.schema ?? []).map((subField) => (
                  <div key={subField.name} className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium">
                      {subField.label}
                      {subField.required && <span className="text-destructive ml-0.5">*</span>}
                    </label>
                    <FieldInput
                      field={subField}
                      value={node.props[subField.name]}
                      onChange={(v) => emit(updateNodeProps(nodeMap, id, { [subField.name]: v }))}
                      uploadBase={uploadBase}
                      i18n={i18n}
                    />
                  </div>
                ))}
              </div>
            </div>
          )
        }}
      />

      {/* Block picker */}
      {!atMax && !isDisabled && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setPickerOpen((o) => !o)}
            className="flex items-center gap-2 px-4 py-2 rounded-md border border-dashed border-input text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors w-full justify-center"
          >
            <span className="text-base leading-none">+</span>
            {addLabel}
          </button>

          {pickerOpen && (
            <div className="absolute bottom-full mb-2 left-0 z-20 w-full rounded-lg border border-border bg-popover shadow-lg py-1 overflow-hidden">
              {blockDefs.map((def) => (
                <button
                  key={def.name}
                  type="button"
                  onClick={() => handleAddBlock(def.name)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-accent hover:text-accent-foreground transition-colors text-left"
                >
                  {def.icon && <span className="text-base shrink-0">{def.icon}</span>}
                  <div>
                    <p className="font-medium">{def.label}</p>
                    <p className="text-xs text-muted-foreground">{def.schema.length} field{def.schema.length !== 1 ? 's' : ''}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
