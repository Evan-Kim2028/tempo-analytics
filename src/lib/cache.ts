import Redis from 'ioredis'

let client: Redis | null = null

function getClient(): Redis {
  if (!client) {
    client = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    })
    client.on('error', () => { /* suppress — cache is best-effort */ })
  }
  return client
}

export async function getCached<T>(key: string): Promise<T | null> {
  try {
    const raw = await getClient().get(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export async function setCached<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  try {
    await getClient().set(key, JSON.stringify(value), 'EX', ttlSeconds)
  } catch {
    // cache write failure is non-fatal
  }
}

export async function deleteCached(key: string): Promise<void> {
  try {
    await getClient().del(key)
  } catch {
    // non-fatal
  }
}
