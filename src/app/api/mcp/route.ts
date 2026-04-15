import { NextRequest } from 'next/server'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { createMcpServer } from '@/mcp/server'

export async function POST(req: NextRequest) {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless mode
    enableJsonResponse: true,
  })

  const server = createMcpServer()
  await server.connect(transport)

  return transport.handleRequest(req)
}

export async function GET(req: NextRequest) {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless mode
  })

  const server = createMcpServer()
  await server.connect(transport)

  return transport.handleRequest(req)
}

export async function DELETE(req: NextRequest) {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless mode
  })

  const server = createMcpServer()
  await server.connect(transport)

  return transport.handleRequest(req)
}
