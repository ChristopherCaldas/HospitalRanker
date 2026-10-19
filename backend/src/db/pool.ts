import { Pool } from 'pg'
import { attachDatabasePool } from '@vercel/functions'
import { requireEnv } from './env'

// One shared pool over Neon's pooled (-pooler) endpoint, used both by the
// local Express server and by the Vercel function. In production the URL is
// the read-only `app_readonly` role (see migrations/007_app_readonly.sql).
export const pool = new Pool({
  connectionString: requireEnv('DATABASE_URL'),
  max: 10,
  idleTimeoutMillis: 30_000,
})

pool.on('error', err => console.error('Postgres pool error', err))

// On Vercel (Fluid compute), let the platform close idle clients before an
// instance is suspended instead of leaking connections.
if (process.env.VERCEL) attachDatabasePool(pool)
