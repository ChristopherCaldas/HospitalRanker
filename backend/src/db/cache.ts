import fs from 'fs'
import path from 'path'

const dataDir = path.join(__dirname, '../../../data')
const cacheFile = path.join(dataDir, 'cache.json')

const CACHE_TTL_MS = 1000 * 60 * 60 * 24 // 24 hours

interface CacheStore {
  [key: string]: { value: unknown; fetchedAt: number }
}

function read(): CacheStore {
  try {
    return JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
  } catch {
    return {}
  }
}

function write(store: CacheStore): void {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(cacheFile, JSON.stringify(store, null, 2))
}

export function getCached<T>(key: string): T | null {
  const store = read()
  const entry = store[key]
  if (!entry || Date.now() - entry.fetchedAt > CACHE_TTL_MS) return null
  return entry.value as T
}

export function setCache(key: string, value: unknown): void {
  const store = read()
  store[key] = { value, fetchedAt: Date.now() }
  write(store)
}
