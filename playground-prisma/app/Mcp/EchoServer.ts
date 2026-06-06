import { McpServer, Name, Version, Instructions } from '@rudderjs/mcp'
import { EchoTool } from './EchoTool.js'

@Name('echo-server')
@Version('1.0.0')
@Instructions('A demo MCP server that echoes messages back.')
export class EchoServer extends McpServer {
  protected tools = [EchoTool]
}
