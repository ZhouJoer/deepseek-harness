/** Tool diagnostics report broken saved paths without losing working installations. @module */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { expect, it } from 'vitest'

it('doctor reports every selected installation and preserves the file when a saved path is invalid', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-tool-doctor-'))
  const file = join(directory, 'tools.json')
  const saved = JSON.stringify({
    'working-tool': { command: process.execPath, versionArgs: ['--version'] },
    'broken-tool': { command: join(directory, 'absent-tool'), versionArgs: ['--version'] },
  })
  try {
    await writeFile(file, saved)
    const result = await execa(process.execPath, ['--import', import.meta.resolve('tsx/esm'),
      fileURLToPath(new URL('./security-tools.ts', import.meta.url)), 'doctor', 'broken-tool', 'working-tool',
      '--config', file, '--save'], {
      cwd: directory, reject: false, timeout: 30_000, stdin: 'ignore',
      env: { TSX_TSCONFIG_PATH: fileURLToPath(new URL('../tsconfig.base.json', import.meta.url)) },
    })
    expect(result.exitCode, result.stderr).toBe(1)
    expect(result.stdout).toContain('broken-tool: invalid configuration')
    expect(result.stdout).toContain('working-tool: available')
    expect(result.stderr).toContain('No configuration changes were saved')
    expect(await readFile(file, 'utf8')).toBe(saved)
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
}, 40_000)
