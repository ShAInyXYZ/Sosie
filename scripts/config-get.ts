// Print one config value for shell scripts: `npx tsx scripts/config-get.ts ports.api`
import { loadConfig } from '../server/config.ts'

const path = process.argv[2]
if (!path) {
  console.error('usage: config-get.ts <dotted.key>')
  process.exit(2)
}
let value: unknown = loadConfig()
for (const part of path.split('.')) value = (value as Record<string, unknown> | undefined)?.[part]
if (value === undefined) {
  console.error(`unknown key: ${path}`)
  process.exit(1)
}
console.log(typeof value === 'object' ? JSON.stringify(value) : String(value))
