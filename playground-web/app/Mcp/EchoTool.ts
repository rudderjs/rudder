import { z } from 'zod'
import { McpTool, McpResponse, Description, Handle } from '@rudderjs/mcp'
import type { McpToolResult } from '@rudderjs/mcp'
import { GreetingService } from '../Services/GreetingService.js'

@Description('Greets someone by name using the app\'s GreetingService')
export class EchoTool extends McpTool {
  schema() {
    return z.object({
      name: z.string().describe('The name to greet'),
    })
  }

  @Handle(GreetingService)
  async handle(input: Record<string, unknown>, greeter: GreetingService): Promise<McpToolResult> {
    return McpResponse.text(greeter.greet(String(input['name'])))
  }
}
