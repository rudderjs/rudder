import { toolDefinition } from '@rudderjs/ai'
import type { AnyTool } from '@rudderjs/ai'
import { z } from 'zod'
import { buildDepartmentAgent } from './buildDepartmentAgent.js'
import type { CanvasNode, DepartmentNode } from '../canvas/CanvasNode.js'

/**
 * Create the `invoke_department` tool from workspace canvas nodes.
 *
 * The orchestrator calls this tool to delegate tasks to department agents.
 * The tool description lists all available departments so the model knows what to route to.
 */
export function createDepartmentTool(nodes: Map<string, CanvasNode>): AnyTool {
  // Collect departments for the tool description
  const departments: { id: string; name: string; description: string }[] = []
  for (const node of nodes.values()) {
    if (node.type === 'department') {
      const dept = node as DepartmentNode
      departments.push({
        id: dept.id,
        name: dept.props.name,
        description: dept.props.instructions ?? '',
      })
    }
  }

  const deptList = departments.length > 0
    ? departments.map(d => `- "${d.name}" (id: ${d.id})${d.description ? `: ${d.description}` : ''}`).join('\n')
    : '(no departments configured)'

  return toolDefinition({
    name: 'invoke_department',
    description: `Delegate a task to a department's AI agents. Choose the most relevant department for the task.\n\nAvailable departments:\n${deptList}`,
    inputSchema: z.object({
      departmentId: z.string().describe('The department ID to delegate to'),
      query: z.string().describe('The task or question to send to the department'),
    }),
  }).server(async ({ departmentId, query }) => {
    const deptAgent = buildDepartmentAgent(departmentId, nodes)
    if (!deptAgent) return `Error: Department "${departmentId}" not found or has no active agents.`

    try {
      const response = await deptAgent.prompt(query)
      return response.text
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return `Error from department: ${msg}`
    }
  })
}
