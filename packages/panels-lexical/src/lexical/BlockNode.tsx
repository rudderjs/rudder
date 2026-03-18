import type { EditorConfig, LexicalEditor, NodeKey, SerializedLexicalNode, Spread } from 'lexical'
import { DecoratorNode } from 'lexical'
import { BlockNodeComponent } from './BlockNodeComponent.js'

export type SerializedBlockNode = Spread<{
  blockType: string
  blockData: Record<string, unknown>
}, SerializedLexicalNode>

export class BlockNode extends DecoratorNode<JSX.Element> {
  __blockType: string
  __blockData: Record<string, unknown>

  static getType(): string { return 'custom-block' }

  static clone(node: BlockNode): BlockNode {
    return new BlockNode(node.__blockType, { ...node.__blockData }, node.__key)
  }

  constructor(blockType: string, blockData: Record<string, unknown>, key?: NodeKey) {
    super(key)
    this.__blockType = blockType
    this.__blockData = blockData
  }

  static importJSON(json: SerializedBlockNode): BlockNode {
    return new BlockNode(json.blockType, json.blockData)
  }

  exportJSON(): SerializedBlockNode {
    return {
      type: 'custom-block',
      version: 1,
      blockType: this.__blockType,
      blockData: this.__blockData,
    }
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const el = document.createElement('div')
    el.setAttribute('data-lexical-block', this.__blockType)
    el.style.display = 'contents'
    return el
  }

  updateDOM(): false { return false }

  decorate(_editor: LexicalEditor, _config: EditorConfig): JSX.Element {
    return (
      <BlockNodeComponent
        nodeKey={this.__key}
        blockType={this.__blockType}
        blockData={this.__blockData}
      />
    )
  }

  setBlockData(data: Record<string, unknown>): void {
    const writable = this.getWritable()
    writable.__blockData = data
  }
}

export function $createBlockNode(blockType: string, blockData?: Record<string, unknown>): BlockNode {
  return new BlockNode(blockType, blockData ?? {})
}

export function $isBlockNode(node: unknown): node is BlockNode {
  return node instanceof BlockNode
}
