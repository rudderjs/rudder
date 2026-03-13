import type { NodeMap, NodeData } from '@boostkit/panels'
import { ensureNodeMap } from '@boostkit/panels'

interface Props {
  value: unknown
  className?: string
}

export function ContentRenderer({ value, className }: Props) {
  const map = ensureNodeMap(value)
  const root = map.ROOT
  if (!root || root.nodes.length === 0) {
    return <span className="text-muted-foreground text-sm">—</span>
  }

  return (
    <div className={['prose prose-sm dark:prose-invert max-w-none', className].filter(Boolean).join(' ')}>
      {root.nodes.map((id) => {
        const node = map[id]
        return node ? <NodeView key={id} nodeId={id} node={node} map={map} /> : null
      })}
    </div>
  )
}

function NodeView({ nodeId, node, map }: { nodeId: string; node: NodeData; map: NodeMap }) {
  const p = node.props
  switch (node.type) {
    case 'paragraph':
      return <p dangerouslySetInnerHTML={{ __html: (p.text as string) || '' }} />
    case 'heading': {
      const Tag = `h${p.level ?? 2}` as 'h1' | 'h2' | 'h3'
      return <Tag dangerouslySetInnerHTML={{ __html: (p.text as string) || '' }} />
    }
    case 'quote':
      return <blockquote dangerouslySetInnerHTML={{ __html: (p.text as string) || '' }} />
    case 'image':
      return (
        <figure>
          <img src={p.src as string} alt={(p.alt as string) ?? ''} />
          {p.caption && <figcaption>{p.caption as string}</figcaption>}
        </figure>
      )
    case 'code':
      return (
        <pre><code className={p.language ? `language-${p.language}` : ''}>
          {p.code as string}
        </code></pre>
      )
    case 'divider':
      return <hr />
    case 'list': {
      const Tag = (p.style as string) === 'numbered' ? 'ol' : 'ul'
      return (
        <Tag>
          {node.nodes.map(itemId => {
            const item = map[itemId]
            if (!item || item.type !== 'list-item') return null
            const sublistId = item.nodes.find(id => map[id]?.type === 'list')
            return (
              <li key={itemId}>
                {(item.props.text as string) || ''}
                {sublistId && map[sublistId] && (
                  <NodeView nodeId={sublistId} node={map[sublistId]!} map={map} />
                )}
              </li>
            )
          })}
          {/* Legacy flat items fallback */}
          {node.nodes.length === 0 && Array.isArray(p.items) && (p.items as string[]).map((item, i) => (
            <li key={i}>{item as string}</li>
          ))}
        </Tag>
      )
    }
    case 'table': {
      const cols = (p.cols as number) ?? 2
      const cellIds = node.nodes
      const rows = Math.ceil(cellIds.length / cols)
      return (
        <table>
          <tbody>
            {Array.from({ length: rows }, (_, r) => (
              <tr key={r}>
                {Array.from({ length: cols }, (_, c) => {
                  const cellId = cellIds[r * cols + c]
                  const cell = cellId ? map[cellId] : null
                  return (
                    <td key={c}>
                      {cell && cell.nodes.map(childId => {
                        const child = map[childId]
                        return child ? <NodeView key={childId} nodeId={childId} node={child} map={map} /> : null
                      })}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )
    }
    case 'table-cell':
    case 'list-item':
      return null
    default:
      return null
  }
}
