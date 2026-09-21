/** Launch the optional security Web profile through the existing dsh CLI. @module */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolveProfileDir } from '../packages/boot/app-boot/src/profile.ts'
import { runCli } from '../apps/cli/src/bin.ts'

const overlays = [
  '../packages/experimental/security-profile/cordis.patch.yml',
  '../packages/experimental/security-web-profile/cordis.patch.yml',
  '../apps/cli/config/examples/security-analysis/cordis.yml',
]
const args = [
  '--profile', 'security',
  ...existsSync(resolveProfileDir('security')) ? [] : ['--from-default-profile', 'web'],
  ...overlays.flatMap(path => ['--patch', fileURLToPath(new URL(path, import.meta.url))]),
  ...process.argv.slice(2),
]
process.argv = [process.execPath, fileURLToPath(new URL('../apps/cli/src/bin.ts', import.meta.url)), ...args]
await runCli()
