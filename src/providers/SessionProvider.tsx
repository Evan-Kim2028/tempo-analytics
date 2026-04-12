'use client'

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

interface SessionState {
  credits: number
  sessionId: string | null
  loading: boolean
}

interface SessionContextValue extends SessionState {
  openSession(depositAmount: string): Promise<void>
  closeSession(): Promise<void>
}

const SessionContext = createContext<SessionContextValue>({
  credits: 0,
  sessionId: null,
  loading: false,
  openSession: async () => {},
  closeSession: async () => {},
})

export function useSession() {
  return useContext(SessionContext)
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({
    credits: 0,
    sessionId: null,
    loading: false,
  })

  const openSession = useCallback(async (depositAmount: string) => {
    setState(s => ({ ...s, loading: true }))
    try {
      const res = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'open', deposit: depositAmount }),
      })
      if (!res.ok) throw new Error('Failed to open session')
      const { sessionId, credits } = await res.json()
      setState({ credits, sessionId, loading: false })
    } catch {
      setState(s => ({ ...s, loading: false }))
    }
  }, [])

  const closeSession = useCallback(async () => {
    if (!state.sessionId) return
    setState(s => ({ ...s, loading: true }))
    try {
      await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'close', sessionId: state.sessionId }),
      })
    } finally {
      setState({ credits: 0, sessionId: null, loading: false })
    }
  }, [state.sessionId])

  return (
    <SessionContext.Provider value={{ ...state, openSession, closeSession }}>
      {children}
    </SessionContext.Provider>
  )
}
