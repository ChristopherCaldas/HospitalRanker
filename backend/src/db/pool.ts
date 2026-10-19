import { Pool } from 'pg'
import { requireEnv } from './env'

// Long-running Express server: one shared pool over Neon's pooled (-pooler) endpoint.
export const pool = new Pool({
  connectionString: requireEnv('DATABASE_URL'),
  max: 10,
  idleTimeoutMillis: 30_000,
})

pool.on('error', err => console.error('Postgres pool error', err))
