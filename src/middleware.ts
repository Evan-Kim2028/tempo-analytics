import { NextRequest, NextResponse } from 'next/server'

export function middleware(req: NextRequest) {
  if (!req.nextUrl.pathname.startsWith('/api/v1/')) return NextResponse.next()

  const authHeader = req.headers.get('Authorization') ?? ''
  const apiKey = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

  if (!apiKey) {
    return NextResponse.json(
      { error: 'API key required. Use Authorization: Bearer <key>' },
      { status: 401 },
    )
  }

  const headers = new Headers(req.headers)
  headers.set('X-Api-Key', apiKey)

  return NextResponse.next({ request: { headers } })
}

export const config = {
  matcher: '/api/v1/:path*',
}
