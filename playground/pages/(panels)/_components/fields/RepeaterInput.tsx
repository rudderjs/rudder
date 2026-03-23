import type { FieldMeta, NodeMap } from '@boostkit/panels'
import { ensureNodeMap, addNode, updateNodeProps, removeNode, reorderNode } from '@boostkit/panels'
import { SortableBlockList } from '../SortableBlockList.js'
import type { FieldInputProps } from './types.js'
import { FieldInput } from '../FieldInput.js'
import { t } from '../../_lib/formHelpers.js'

export function RepeaterInput({ field, value, onChange, uploadBase, disabled = false, i18n }: FieldInputProps) {
  const isDisabled = disabled || field.readonly
  const schema   = (field.extra?.schema ?? []) as FieldMeta[]
  const addLabel = (field.extra?.addLabel as string) ?? i18n.addItem
  const maxItems = field.extra?.maxItems as number | undefined
  const nodeMap  = ensureNodeMap(value)
  const root     = nodeMap.ROOT ?? { type: 'container', props: {}, parent: '', nodes: [] }
  const nodeIds  = root.nodes

  function emit(next: NodeMap) { onChange(next) }

  function handleAddItem() {
    if (maxItems !== undefined && nodeIds.length >= maxItems) return
    const props: Record<string, unknown> = {}
    for (const f of schema) props[f.name] = undefined
    const { map } = addNode(nodeMap, 'item', props)
    emit(map)
  }

  function handleReorder(fromIndex: number, toIndex: number) {
    const id = nodeIds[fromIndex]
    if (!id) return
    emit(reorderNode(nodeMap, id, fromIndex, toIndex))
  }

  return (
    <div className="flex flex-col gap-3">
      <SortableBlockList
        nodeIds={nodeIds}
        onReorder={handleReorder}
        disabled={isDisabled}
        renderNode={(id, index) => {
          const node = nodeMap[id]
          if (!node) return null
          return (
            <div className="rounded-lg border border-input bg-card p-4 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {t(i18n.item, { n: index + 1 })}
                </span>
                {!isDisabled && (
                  <button
                    type="button"
                    onClick={() => emit(removeNode(nodeMap, id))}
                    className="text-xs text-destructive hover:underline"
                  >
                    {i18n.remove}
                  </button>
                )}
              </div>

              {schema.map((subField) => (
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
          )
        }}
      />

      {!isDisabled && (maxItems === undefined || nodeIds.length < maxItems) && (
        <button
          type="button"
          onClick={handleAddItem}
          className="flex items-center gap-2 px-4 py-2 rounded-md border border-dashed border-input text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors w-full justify-center"
        >
          <span className="text-base leading-none">+</span>
          {addLabel}
        </button>
      )}
    </div>
  )
}
