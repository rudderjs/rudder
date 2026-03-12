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
        return node ? <NodeView key={id} node={node} /> : null
      })}
    </div>
  )
}

function NodeView({ node }: { node: NodeData }) {
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
          {(Array.isArray(p.items) ? p.items : []).map((item, i) => (
            <li key={i}>{item as string}</li>
          ))}
        </Tag>
      )
    }
    default:
      return null
  }
}
