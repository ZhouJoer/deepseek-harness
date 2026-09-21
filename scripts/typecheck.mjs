/** Build Host declarations and Remote clients before checking Client types, without a package manager on PATH. */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const { values } = parseArgs({ options: { 'host-only': { type: 'boolean', default: false } } })
const compiler = require.resolve('typescript/bin/tsc')
const commands = [
  ['--max-old-space-size=4096', compiler, '-b', 'tsconfig.host.json'],
  [require.resolve('tsdown/run'), '--env.DSH_BUILD_FACE', 'host'],
]
if (!values['host-only']) commands.push([compiler, '-b', 'tsconfig.client.json'])

for (const args of commands) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) {
    if (result.signal) console.error(`Typecheck interrupted by ${result.signal}`)
    process.exit(result.status ?? 1)
  }
}
