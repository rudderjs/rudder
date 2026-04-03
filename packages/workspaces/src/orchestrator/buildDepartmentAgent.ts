import { agent } from '@rudderjs/ai'
import type { Agent } from '@rudderjs/ai'
import type { CanvasNode, AgentNode, DepartmentNode } from '../canvas/CanvasNode.js'

/**
 * Build an AI agent from department + agent workspace nodes.
 *
 * Combines department instructions with the primary agent's system prompt and model config.
 * Returns null if the department doesn't exist or has no active agents.
 */
export function buildDepartmentAgent(
  departmentId: string,
  nodes: Map<string, CanvasNode>,
): Agent | null {
  const deptNode = nodes.get(departmentId)
  if (!deptNode || deptNode.type !== 'department') return null

  const dept = deptNode as DepartmentNode

  // Find active agents in this department
  const agentNodes: AgentNode[] = []
  for (const node of nodes.values()) {
    if (
      node.type === 'agent' &&
      node.parentId === departmentId &&
      (node as AgentNode).props.active !== false
    ) {
      agentNodes.push(node as AgentNode)
    }
  }

  // Use the first active agent's config
  const primary = agentNodes[0]

  // Build combined instructions
  const parts: string[] = []
  if (dept.props.instructions) parts.push(dept.props.instructions)
  if (primary?.props.systemPrompt) parts.push(primary.props.systemPrompt)

  const fallbackInstructions = primary
    ? `You are ${primary.props.name}, part of the ${dept.props.name} department.`
    : `You are the ${dept.props.name} department.`

  const instructions = parts.length > 0 ? parts.join('\n\n') : fallbackInstructions

  return agent({
    instructions,
    model: primary?.props.model || undefined,
  })
}
