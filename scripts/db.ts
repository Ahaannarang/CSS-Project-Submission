import 'dotenv/config'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import postgres from 'postgres'

const cmd = process.argv[2] ?? 'migrate'
const url = process.env.DATABASE_URL
if (!url) { console.error('DATABASE_URL is not set'); process.exit(1) }
const sql = postgres(url, { ssl: url.includes('localhost') ? false : 'require', max: 1 })

const run = async () => {
  if (cmd === 'reset') {
    console.log('dropping schema...')
    await sql.unsafe(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`)
  }
  const dir = join(process.cwd(), 'sql')
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    process.stdout.write(`applying ${f} ... `)
    await sql.unsafe(readFileSync(join(dir, f), 'utf8'))
    console.log('ok')
  }
  await sql.end()
}
run().catch((e) => { console.error(e); process.exit(1) })
