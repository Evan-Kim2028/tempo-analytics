type CacheEntry = {
  value: string
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()

function isExpired(entry: CacheEntry): boolean {
  return Date.now() >= entry.expiresAt
}

export async function getCached<T>(key: string): Promise<T | null> {
  try {
    const entry = cache.get(key)
    if (!entry) return null
    if (isExpired(entry)) {
      cache.delete(key)
      return null
    }
    return JSON.parse(entry.value) as T
  } catch {
    return null
  }
}

export async function setCached<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  try {
    if (ttlSeconds <= 0) {
      cache.delete(key)
      return
    }

    cache.set(key, {
      value: JSON.stringify(value),
      expiresAt: Date.now() + (ttlSeconds * 1000),
    })
  } catch {
    // cache write failure is non-fatal
  }
}

export async function deleteCached(key: string): Promise<void> {
  try {
    cache.delete(key)
  } catch {
    // non-fatal
  }
}
