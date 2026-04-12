import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { getQueryCatalog, executeQuery, formatJson } from '@/lib/dataService'

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'tempo-analytics',
    version: '1.0.0',
  })

  for (const entry of getQueryCatalog()) {
    const toolName = `tempo_${entry.key.replace(/-/g, '_')}`

    if (entry.params && entry.params.length > 0) {
      const shape: Record<string, z.ZodString> = {}
      for (const p of entry.params) {
        shape[p.name] = z.string().describe(`${p.name} parameter`)
      }
      server.tool(toolName, entry.description, shape, async (params) => {
        const result = await executeQuery(entry.key, params as Record<string, string>)
        const json = formatJson(result)
        return { content: [{ type: 'text' as const, text: JSON.stringify(json) }] }
      })
    } else {
      server.tool(toolName, entry.description, async () => {
        const result = await executeQuery(entry.key)
        const json = formatJson(result)
        return { content: [{ type: 'text' as const, text: JSON.stringify(json) }] }
      })
    }
  }

  return server
}
