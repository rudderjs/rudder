import { useState } from 'react'
import type { CanvasNodeType } from '../../../src/canvas/CanvasNode.js'

export type CanvasTool = 'select' | 'pan' | 'add-department' | 'add-agent' | 'add-kb' | 'connect' | 'delete'

interface CanvasToolbarProps {
  activeTool: CanvasTool
  onToolChange: (tool: CanvasTool) => void
  editable: boolean
}

const tools: { id: CanvasTool; label: string; icon: string }[] = [
  { id: 'select', label: 'Select', icon: '↖' },
  { id: 'pan', label: 'Pan', icon: '✋' },
  { id: 'add-department', label: 'Department', icon: '▢' },
  { id: 'add-agent', label: 'Agent', icon: '🤖' },
  { id: 'add-kb', label: 'Knowledge Base', icon: '📚' },
  { id: 'connect', label: 'Connect', icon: '→' },
  { id: 'delete', label: 'Delete', icon: '🗑' },
]

/** Floating toolbar for canvas tools */
export function CanvasToolbar({ activeTool, onToolChange, editable }: CanvasToolbarProps) {
  if (!editable) return null

  return (
    <div style={{
      position: 'absolute',
      top: 12,
      right: 12,
      display: 'flex',
      gap: 2,
      background: 'white',
      borderRadius: 8,
      padding: 4,
      boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
      zIndex: 10,
    }}>
      {tools.map(tool => (
        <button
          key={tool.id}
          onClick={() => onToolChange(tool.id)}
          title={tool.label}
          style={{
            width: 36,
            height: 36,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 16,
            background: activeTool === tool.id ? '#6366f1' : 'transparent',
            color: activeTool === tool.id ? 'white' : '#64748b',
            transition: 'all 0.15s',
          }}
        >
          {tool.icon}
        </button>
      ))}
    </div>
  )
}

/** Map toolbar add tools to node types */
export function toolToNodeType(tool: CanvasTool): CanvasNodeType | null {
  switch (tool) {
    case 'add-department': return 'department'
    case 'add-agent': return 'agent'
    case 'add-kb': return 'knowledgeBase'
    default: return null
  }
}
