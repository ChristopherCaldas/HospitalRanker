import { pool } from './pool'

const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS) || 1000 * 60 * 60 * 24 // 24 hours

export async function getCached<T>(key: string): Promise<T | null> {
  const { rows } = await pool.query<{ value: T }>(
    `SELECT value FROM cms_cache
     WHERE key = $1 AND fetched_at > now() - make_interval(secs => $2)`,
    [key, CACHE_TTL_MS / 1000]
  )
  return rows[0]?.value ?? null
}

export async function setCache(key: string, value: unknown): Promise<void> {
  await pool.query(
    `INSERT INTO cms_cache (key, value, fetched_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, fetched_at = EXCLUDED.fetched_at`,
    [key, JSON.stringify(value)]
  )
}
