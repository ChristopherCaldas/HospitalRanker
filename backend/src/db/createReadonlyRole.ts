import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { Client } from 'pg'
import { requireEnv } from './env'

// Creates (or rotates the password of) the `app_readonly` role the public
// site connects as, applies its grants, and writes its pooled connection
// string to the repo root's .env.local as APP_READONLY_DATABASE_URL.
// The password is generated here and never printed or committed.
//
//   npm run create-readonly-role --workspace=backend

const ROLE = 'app_readonly'
const envFile = path.join(__dirname, '../../../.env.local')
const grants = fs.readFileSync(path.join(__dirname, '../../migrations/007_app_readonly.sql'), 'utf8')

async function main() {
  const db = new Client({ connectionString: requireEnv('DATABASE_URL_UNPOOLED') })
  await db.connect()
  const password = crypto.randomBytes(24).toString('base64url')

  try {
    const { rowCount } = await db.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [ROLE])
    // DDL can't take bind parameters; the password is base64url, so it's literal-safe.
    await db.query(`${rowCount ? 'ALTER' : 'CREATE'} ROLE ${ROLE} WITH LOGIN PASSWORD ${db.escapeLiteral(password)}`)
    await db.query(grants)
    console.log(`${rowCount ? 'rotated password for' : 'created'} role ${ROLE} and applied read-only grants`)
  } finally {
    await db.end()
  }

  const url = new URL(requireEnv('DATABASE_URL')) // pooled endpoint
  url.username = ROLE
  url.password = password
  const line = `APP_READONLY_DATABASE_URL="${url.toString()}"`
  const current = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : ''
  const next = /^APP_READONLY_DATABASE_URL=.*$/m.test(current)
    ? current.replace(/^APP_READONLY_DATABASE_URL=.*$/m, line)
    : `${current.trimEnd()}\n${line}\n`
  fs.writeFileSync(envFile, next)
  console.log(`wrote APP_READONLY_DATABASE_URL to ${envFile}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
