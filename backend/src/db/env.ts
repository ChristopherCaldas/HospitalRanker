import fs from 'fs'
import path from 'path'

// `neon deploy` / `neon env pull` write DATABASE_URL etc. to the repo root.
// Real environment variables (e.g. on a host) take precedence over these files.
const rootDir = path.join(__dirname, '../../..')

for (const file of ['.env.local', '.env']) {
  const fullPath = path.join(rootDir, file)
  if (fs.existsSync(fullPath)) process.loadEnvFile(fullPath)
}

export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set. Run \`neon env pull\` from the repo root.`)
  return value
}
