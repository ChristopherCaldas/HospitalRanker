import fs from 'fs'
import path from 'path'
import { Client } from 'pg'
import { requireEnv } from './env'

// Applies backend/migrations/*.sql in filename order, each in its own transaction.
// Uses the direct (unpooled) connection, as PgBouncer transaction mode breaks migrations.
const migrationsDir = path.join(__dirname, '../../migrations')

async function main() {
  const client = new Client({ connectionString: requireEnv('DATABASE_URL_UNPOOLED') })
  await client.connect()

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `)
    const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations')
    const applied = new Set(rows.map(r => r.name))

    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()
    for (const file of files) {
      if (applied.has(file)) continue
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8')
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file])
        await client.query('COMMIT')
        console.log(`applied ${file}`)
      } catch (err) {
        await client.query('ROLLBACK')
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`)
      }
    }
    console.log('migrations up to date')
  } finally {
    await client.end()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
